document.addEventListener("DOMContentLoaded", function () {
    const API_BASE = "http://127.0.0.1:5000";

    const rows = document.getElementById("reservationRows");
    const countLabel = document.getElementById("adminCount");
    const message = document.getElementById("adminMessage");
    const refreshButton = document.getElementById("refreshButton");

    const formatDate = value =>
        new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });

    function cell(text, className) {
        const td = document.createElement("td");

        if (className) {
            td.className = className;
        }

        td.textContent = text;
        return td;
    }

    function guestCell(reservation) {
        const td = document.createElement("td");

        const name = document.createElement("span");
        name.className = "admin-guest-name";
        name.textContent = reservation.guest_name;

        const email = document.createElement("span");
        email.className = "admin-guest-meta";
        email.textContent = reservation.guest_email || "no email";

        const phone = document.createElement("span");
        phone.className = "admin-guest-meta";
        phone.textContent = reservation.guest_phone || "no phone";

        td.append(name, email, phone);
        return td;
    }

    function roomCell(reservation) {
        const td = document.createElement("td");

        const number = document.createElement("span");
        number.className = "admin-guest-name";
        number.textContent = reservation.room_number;

        const type = document.createElement("span");
        type.className = "admin-guest-meta";
        type.textContent = reservation.room_type;

        td.append(number, type);
        return td;
    }

    function statusCell(status) {
        const td = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = `admin-badge is-${status}`;
        badge.textContent = status;
        td.appendChild(badge);
        return td;
    }

    function actionCell(reservation) {
        const td = document.createElement("td");

        if (reservation.status === "cancelled") {
            td.textContent = "—";
            return td;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "admin-cancel";
        button.textContent = "Cancel";
        button.setAttribute(
            "aria-label",
            `Cancel reservation ${reservation.id}`
        );
        button.addEventListener("click", () =>
            cancelReservation(reservation.id, button)
        );

        td.appendChild(button);
        return td;
    }

    function render(reservations) {
        rows.replaceChildren();

        if (reservations.length === 0) {
            const tr = document.createElement("tr");
            const td = cell("No reservations yet.");
            td.colSpan = 9;
            td.classList.add("admin-empty");
            tr.appendChild(td);
            rows.appendChild(tr);
            return;
        }

        reservations.forEach(reservation => {
            const tr = document.createElement("tr");

            tr.append(
                cell(reservation.id),
                guestCell(reservation),
                roomCell(reservation),
                cell(formatDate(reservation.check_in)),
                cell(formatDate(reservation.check_out)),
                cell(reservation.nights),
                statusCell(reservation.status),
                cell(reservation.payment_method || "—"),
                actionCell(reservation)
            );

            rows.appendChild(tr);
        });
    }

    function showMessage(text, tone) {
        message.textContent = text || "";
        message.classList.toggle("is-success", tone === "success");
    }

    async function loadReservations() {
        refreshButton.disabled = true;
        showMessage("");

        try {
            const response = await fetch(`${API_BASE}/api/reservations`);

            if (!response.ok) {
                throw new Error(`GET /api/reservations failed with HTTP ${response.status}`);
            }

            const data = await response.json();

            render(data.reservations);

            countLabel.textContent =
                `${data.count} reservation${data.count === 1 ? "" : "s"}`;

            return true;
        } catch (error) {
            console.error(error);
            rows.replaceChildren();
            countLabel.textContent = "—";
            showMessage(
                "Could not load reservations. The booking service did not respond."
            );
            return false;
        } finally {
            refreshButton.disabled = false;
        }
    }

    async function cancelReservation(id, button) {
        if (!window.confirm(
            `Cancel reservation #${id}? The room becomes free for those dates.`
        )) {
            return;
        }

        button.disabled = true;
        showMessage("");

        try {
            const response = await fetch(
                `${API_BASE}/api/reservations/${id}/cancel`,
                { method: "POST" }
            );

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }

            if (await loadReservations()) {
                showMessage(`Reservation #${id} cancelled.`, "success");
            }
        } catch (error) {
            console.error(error);
            button.disabled = false;
            showMessage(
                error.message || "Could not cancel the reservation. Please try again."
            );
        }
    }

    refreshButton.addEventListener("click", loadReservations);
    loadReservations();
});
