import os
from contextlib import contextmanager
from datetime import date

from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.exceptions import HTTPException

load_dotenv()

app = Flask(__name__)

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if origin.strip()
]
CORS(app, resources={r"/api/*": {"origins": FRONTEND_ORIGINS}})

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Create a .env file with DATABASE_URL=<your connection string>."
    )

db_pool = pool.SimpleConnectionPool(1, 10, dsn=DATABASE_URL)

PAYMENT_METHODS = ("GCash", "Maya", "Card")


class ApiError(Exception):
    """An expected request error that should be returned as JSON."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


@contextmanager
def db_cursor():
    """Borrows a pooled connection and commits when the block succeeds."""
    conn = db_pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db_pool.putconn(conn)


@app.errorhandler(ApiError)
def handle_api_error(error):
    return jsonify({
        "status": "error",
        "message": error.message
    }), error.status


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return error
    app.logger.exception("Unhandled error on %s", request.path)
    return jsonify({
        "status": "error",
        "message": "Internal server error"
    }), 500


def room_json(row):
    """The room fields shared by the rooms and availability responses."""
    return {
        "id": row["id"],
        "room_number": row["room_number"],
        "room_type": row["room_type"],
        "price_per_night": str(row["price_per_night"]) if row["price_per_night"] is not None else None,
        "capacity": row["capacity"],
    }


@app.route("/")
def home():
    return jsonify({
        "status": "online",
        "app": "Scuffed Inn Reservation System"
    }), 200


@app.route("/db-check")
def db_check():
    """Health check endpoint to test active Supabase queries."""
    with db_cursor() as cursor:
        cursor.execute("SELECT version() AS version")
        db_version = cursor.fetchone()["version"]

    return jsonify({
        "status": "success",
        "message": "Successfully queried Supabase PostgreSQL database!",
        "version": db_version
    }), 200


@app.route("/api/rooms")
def api_rooms():
    """Lists every room, available or not."""
    with db_cursor() as cursor:
        cursor.execute("""
            SELECT id, room_number, room_type, price_per_night, capacity
            FROM rooms
            ORDER BY room_number
        """)
        rows = cursor.fetchall()

    rooms = [room_json(row) for row in rows]

    return jsonify({"rooms": rooms, "count": len(rooms)}), 200


@app.route("/api/availability")
def api_availability():
    """
    Rooms that are free for a stay.
    Two stays overlap when one starts before the other ends, so a room is free
    when no active reservation satisfies:
        res.check_in < wanted_check_out AND res.check_out > wanted_check_in
    """
    try:
        check_in = date.fromisoformat(request.args.get("check_in", ""))
        check_out = date.fromisoformat(request.args.get("check_out", ""))
    except ValueError:
        return jsonify({
            "status": "error",
            "message": "check_in and check_out are required, in YYYY-MM-DD format"
        }), 400

    if check_out <= check_in:
        return jsonify({
            "status": "error",
            "message": "check_out must be after check_in"
        }), 400

    with db_cursor() as cursor:
        cursor.execute("""
            SELECT r.id, r.room_number, r.room_type, r.price_per_night, r.capacity
            FROM rooms r
            WHERE NOT EXISTS (
                SELECT 1
                FROM reservations res
                WHERE res.room_id = r.id
                  AND res.status <> 'cancelled'
                  AND res.check_in  < %s
                  AND res.check_out > %s
            )
            ORDER BY r.room_number
        """, (check_out, check_in))
        rows = cursor.fetchall()

    rooms = [room_json(row) for row in rows]

    return jsonify({
        "check_in": check_in.isoformat(),
        "check_out": check_out.isoformat(),
        "rooms": rooms,
        "count": len(rooms)
    }), 200


@app.route("/api/reservations", methods=["POST"])
def api_create_reservation():
    """
    Creates a booking.
    Body: room_id, check_in, check_out, full_name, email?, phone?, payment_method?
    The guest is reused when the email already exists.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({
            "status": "error",
            "message": "Send a JSON body"
        }), 400

    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None
    room_id = data.get("room_id")
    payment_method = (data.get("payment_method") or "").strip() or None

    if not full_name:
        return jsonify({
            "status": "error",
            "message": "full_name is required"
        }), 400
    for field, value, limit in (
        ("full_name", full_name, 120),
        ("email", email, 200),
        ("phone", phone, 40),
    ):
        if value and len(value) > limit:
            return jsonify({
                "status": "error",
                "message": f"{field} must be {limit} characters or fewer"
            }), 400
    if not isinstance(room_id, int) or isinstance(room_id, bool):
        return jsonify({
            "status": "error",
            "message": "room_id is required and must be an integer"
        }), 400
    if payment_method is not None and payment_method not in PAYMENT_METHODS:
        allowed = ", ".join(PAYMENT_METHODS[:-1]) + " or " + PAYMENT_METHODS[-1]
        return jsonify({
            "status": "error",
            "message": f"payment_method must be {allowed}"
        }), 400

    try:
        check_in = date.fromisoformat(data.get("check_in", ""))
        check_out = date.fromisoformat(data.get("check_out", ""))
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "check_in and check_out are required, in YYYY-MM-DD format"
        }), 400

    if check_out <= check_in:
        return jsonify({
            "status": "error",
            "message": "check_out must be after check_in"
        }), 400

    if check_in < date.today():
        return jsonify({
            "status": "error",
            "message": "check_in cannot be in the past"
        }), 400

    with db_cursor() as cursor:
        cursor.execute("SELECT id FROM rooms WHERE id = %s FOR UPDATE", (room_id,))
        if cursor.fetchone() is None:
            raise ApiError(404, "Room not found")

        cursor.execute("""
            SELECT 1
            FROM reservations
            WHERE room_id = %s
              AND status <> 'cancelled'
              AND check_in  < %s
              AND check_out > %s
            LIMIT 1
        """, (room_id, check_out, check_in))
        if cursor.fetchone() is not None:
            raise ApiError(409, "Room is not available for those dates")

        guest_id = None
        if email:
            cursor.execute(
                "SELECT id FROM guests WHERE lower(email) = lower(%s)",
                (email,)
            )
            existing = cursor.fetchone()
            if existing:
                guest_id = existing["id"]

        if guest_id is None:
            cursor.execute("""
                INSERT INTO guests (full_name, email, phone)
                VALUES (%s, %s, %s)
                RETURNING id
            """, (full_name, email, phone))
            guest_id = cursor.fetchone()["id"]

        cursor.execute("""
            INSERT INTO reservations
                (guest_id, room_id, check_in, check_out, status, payment_method)
            VALUES (%s, %s, %s, %s, 'pending', %s)
            RETURNING reservation_number, guest_id, room_id, check_in, check_out,
                      status, created_at, payment_method
        """, (guest_id, room_id, check_in, check_out, payment_method))
        created = cursor.fetchone()

    return jsonify({
        "message": "Reservation created",
        "reservation": {
            "id": created["reservation_number"],
            "guest_id": str(created["guest_id"]),
            "room_id": created["room_id"],
            "check_in": created["check_in"].isoformat(),
            "check_out": created["check_out"].isoformat(),
            "status": created["status"],
            "payment_method": created["payment_method"],
            "created_at": created["created_at"].isoformat(),
        }
    }), 201


@app.route("/api/reservations")
def api_reservations():
    """Lists every booking with the guest and room details the admin page needs."""
    with db_cursor() as cursor:
        cursor.execute("""
            SELECT r.reservation_number AS id,
                   r.guest_id,
                   g.full_name  AS guest_name,
                   g.email      AS guest_email,
                   g.phone      AS guest_phone,
                   r.room_id,
                   rm.room_number,
                   rm.room_type,
                   r.check_in,
                   r.check_out,
                   r.status,
                   r.payment_method,
                   r.created_at
            FROM reservations r
            JOIN guests g ON g.id = r.guest_id
            JOIN rooms rm ON rm.id = r.room_id
            ORDER BY r.check_in DESC, r.reservation_number DESC
        """)
        rows = cursor.fetchall()

    reservations = [
        {
            "id": row["id"],
            "guest_id": str(row["guest_id"]),
            "guest_name": row["guest_name"],
            "guest_email": row["guest_email"],
            "guest_phone": row["guest_phone"],
            "room_id": row["room_id"],
            "room_number": row["room_number"],
            "room_type": row["room_type"],
            "check_in": row["check_in"].isoformat(),
            "check_out": row["check_out"].isoformat(),
            "nights": (row["check_out"] - row["check_in"]).days,
            "status": row["status"],
            "payment_method": row["payment_method"],
            "created_at": row["created_at"].isoformat(),
        }
        for row in rows
    ]

    return jsonify({"reservations": reservations, "count": len(reservations)}), 200


@app.route("/api/reservations/<int:reservation_id>/cancel", methods=["POST"])
def api_cancel_reservation(reservation_id):
    """
    Cancels a booking. Availability is decided by the stay dates, so cancelling
    frees the room automatically.
    """
    with db_cursor() as cursor:
        cursor.execute("""
            SELECT reservation_number, status, room_id, check_in, check_out
            FROM reservations
            WHERE reservation_number = %s
            FOR UPDATE
        """, (reservation_id,))
        row = cursor.fetchone()

        if row is None:
            raise ApiError(404, "Reservation not found")

        already_cancelled = row["status"] == "cancelled"

        if not already_cancelled:
            cursor.execute("""
                UPDATE reservations
                SET status = 'cancelled'
                WHERE reservation_number = %s
            """, (reservation_id,))

    return jsonify({
        "message": "Reservation was already cancelled" if already_cancelled else "Reservation cancelled",
        "reservation": {
            "id": row["reservation_number"],
            "room_id": row["room_id"],
            "check_in": row["check_in"].isoformat(),
            "check_out": row["check_out"].isoformat(),
            "status": "cancelled",
        }
    }), 200


@app.route("/api/reservations/<int:reservation_id>", methods=["DELETE"])
def api_delete_reservation(reservation_id):
    """
    Deletes a booking permanently. Availability is decided by the stay dates,
    so deleting frees the room automatically.
    """
    with db_cursor() as cursor:
        cursor.execute("""
            DELETE FROM reservations
            WHERE reservation_number = %s
            RETURNING reservation_number
        """, (reservation_id,))
        deleted = cursor.fetchone()

        if deleted is None:
            raise ApiError(404, "Reservation not found")

    return jsonify({
        "message": "Reservation deleted",
        "reservation": {
            "id": deleted["reservation_number"],
        }
    }), 200


if __name__ == "__main__":
    app.run(debug=True, port=5000)