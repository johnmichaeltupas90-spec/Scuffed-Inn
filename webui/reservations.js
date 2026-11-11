document.addEventListener("DOMContentLoaded", function () {

 
    // Rooms are loaded from the API (GET /api/rooms) and grouped by room type.
    // Keys are slugs derived from `room_type`, e.g. "Single King Bed" -> "single-king".
    const API_BASE = "http://127.0.0.1:5000";
    let rooms = {};
    let freeNumbers = null;      // room numbers free for the chosen dates (Set)
    let availabilityToken = 0;   // ignores out-of-order availability responses

    const $ = id => document.getElementById(id);

    const form = $("reservationForm");
    const roomType = $("roomType");
    const roomNumber = $("roomNumber");
    const guests = $("guests");
    const checkIn = $("checkIn");
    const checkOut = $("checkOut");
    const overlay = $("confirmationOverlay");

    const money = amount =>
        new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP"
        }).format(amount);

    // "Single King Bed" -> "single-king"
    function slugifyRoomType(roomType) {
        return roomType
            .toLowerCase()
            .replace(/\s+bed$/, "")
            .trim()
            .replace(/\s+/g, "-");
    }

    function imageForRoomType(roomType) {
        const type = roomType.toLowerCase();
        if (type.startsWith("suite")) return "images/suite.png";
        if (type.startsWith("double")) return "images/deluxe.png";
        return "images/standard.png";
    }

    // Room 101 is on the 1st floor, 201 on the 2nd, 301 on the 3rd.
    function floorForRoomNumber(roomNumber) {
        const firstDigit = String(roomNumber).charAt(0);
        if (firstDigit === "1") return "1st Floor";
        if (firstDigit === "2") return "2nd Floor";
        if (firstDigit === "3") return "3rd Floor";
        return "—";
    }

    // Groups GET /api/rooms by room type:
    //   { "single-king": { name, price, floor, capacity, numbers[], image } }
    async function loadRooms() {
        const response = await fetch(`${API_BASE}/api/rooms`);

        if (!response.ok) {
            throw new Error(`GET /api/rooms failed with HTTP ${response.status}`);
        }

        const data = await response.json();
        const catalog = {};

        data.rooms.forEach(room => {
            const slug = slugifyRoomType(room.room_type);

            if (!catalog[slug]) {
                catalog[slug] = {
                    name: room.room_type,
                    price: Number(room.price_per_night),
                    floor: floorForRoomNumber(room.room_number),
                    capacity: Number(room.capacity),
                    numbers: [],
                    ids: {},
                    image: imageForRoomType(room.room_type)
                };
            }

            catalog[slug].numbers.push(String(room.room_number));
            catalog[slug].ids[String(room.room_number)] = room.id;
            catalog[slug].capacity = Math.max(
                catalog[slug].capacity,
                Number(room.capacity)
            );
        });

        return catalog;
    }

    function setRoomStatus(text, available) {
        $("roomStatus").textContent = text;
        $("roomStatus").classList.toggle("available", Boolean(available));
    }

    // Rebuilds the room-number list for the selected type, limited to the rooms
    // the API reported as free when we have that answer.
    function populateRoomNumbers() {
        const room = selectedRoom();
        const previous = roomNumber.value;

        roomNumber.innerHTML = '<option value="">Select room number</option>';

        if (!room) {
            roomNumber.disabled = true;
            setRoomStatus("Select a room type", false);
            return;
        }

        roomNumber.disabled = false;

        const numbers = freeNumbers
            ? room.numbers.filter(number => freeNumbers.has(number))
            : room.numbers;

        // No free room of this type for the chosen dates: nothing to pick.
        roomNumber.disabled = numbers.length === 0;

        numbers.forEach(number => {
            const option = document.createElement("option");
            option.value = number;
            option.textContent = number;
            roomNumber.appendChild(option);
        });

        // Keep the user's choice when a late availability answer rebuilds the list.
        if (previous && numbers.includes(previous)) {
            roomNumber.value = previous;
        }

        if (freeNumbers) {
            setRoomStatus(
                numbers.length === 0
                    ? "No rooms available for these dates"
                    : "Select a room number",
                false
            );
        }
    }

    async function refreshAvailability() {
        const nights = getNights();

        if (nights < 1) {
            freeNumbers = null;
            populateRoomNumbers();
            setRoomStatus("Pick your dates to check", false);
            return;
        }

        const token = ++availabilityToken;
        setRoomStatus("Checking availability…", false);

        try {
            const response = await fetch(
                `${API_BASE}/api/availability?check_in=${encodeURIComponent(checkIn.value)}` +
                `&check_out=${encodeURIComponent(checkOut.value)}`
            );

            if (!response.ok) {
                throw new Error(`GET /api/availability failed with HTTP ${response.status}`);
            }

            const data = await response.json();

            if (token !== availabilityToken) return;

            freeNumbers = new Set(data.rooms.map(room => String(room.room_number)));
            populateRoomNumbers();
        } catch (error) {
            if (token !== availabilityToken) return;

            console.error(error);
            freeNumbers = null;
            populateRoomNumbers();
            setRoomStatus("Could not check availability", false);
        }
    }

    function localDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function parseDate(value) {
        if (!value) return null;
        return new Date(`${value}T12:00:00`);
    }

    function formatDate(value) {
        const date = parseDate(value);
        return date
            ? date.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric"
            })
            : "—";
    }

    function getNights() {
        const start = parseDate(checkIn.value);
        const end = parseDate(checkOut.value);
        if (!start || !end || end <= start) {
            return 0;
        }
        return Math.round(
            (end.getTime() - start.getTime()) / 86400000
        );
    }

    function selectedRoom() {
        return rooms[roomType.value] || null;
    }

    function updateTotal() {
        const room = selectedRoom();
        const nights = getNights();
        const total = room ? room.price * nights : 0;

        $("totalAmount").textContent = money(total);

        $("priceBreakdown").textContent =
            room && nights > 0
                ? `${money(room.price)} × ${nights} night(s)`
                : "Select a room and valid booking dates to calculate the total.";

        return total;
    }

    roomType.addEventListener("change", function () {
        const room = selectedRoom();

        $("formMessage").textContent = "";

        guests.innerHTML =
            '<option value="">Select guests</option>';

        if (!room) {
            roomNumber.innerHTML =
                '<option value="">Select room number</option>';
            roomNumber.disabled = true;
            $("roomFloor").textContent = "—";
            $("roomCapacity").textContent = "—";
            setRoomStatus("Select a room", false);
            $("roomPrice").textContent = money(0);
            $("roomPreview").src = "images/standard.png";
            updateTotal();
            return;
        }

        for (let i = 1; i <= room.capacity; i++) {
            const option = document.createElement("option");
            option.value = i;
            option.textContent = `${i} Guest${i > 1 ? "s" : ""}`;
            guests.appendChild(option);
        }

        $("roomPreview").src = room.image;
        $("roomFloor").textContent = room.floor;
        $("roomCapacity").textContent =
            `Up to ${room.capacity} Guests`;
        $("roomPrice").textContent = money(room.price);

        populateRoomNumbers();

        if (!freeNumbers) {
            setRoomStatus("Pick your dates to check", false);
        }

        updateTotal();

        if (getNights() >= 1 && freeNumbers === null) {
            refreshAvailability();
        }
    });

    roomNumber.addEventListener("change", function () {
        $("formMessage").textContent = "";

        if (!roomNumber.value) {
            setRoomStatus(
                freeNumbers
                    ? "Select a room number"
                    : "Pick your dates to check",
                false
            );
            return;
        }

        if (freeNumbers) {
            setRoomStatus("Available for these dates", true);
        } else {
            setRoomStatus("Pick your dates to check", false);
        }
    });

    // Set minimum dates.
    const today = localDateString(new Date());

    checkIn.min = today;
    checkOut.min = today;

    checkIn.addEventListener("change", function () {
        if (checkIn.value) {
            const nextDay = parseDate(checkIn.value);
            nextDay.setDate(nextDay.getDate() + 1);

            checkOut.min = localDateString(nextDay);

            if (checkOut.value <= checkIn.value) {
                checkOut.value = "";
            }
        }
        updateTotal();
        $("formMessage").textContent = "";
        refreshAvailability();
    });

    checkOut.addEventListener("change", function () {
        updateTotal();
        $("formMessage").textContent = "";
        refreshAvailability();
    });

    // Send the booking to the API, then show the real reservation id.
    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!form.reportValidity()) return;

        const room = selectedRoom();
        const nights = getNights();

        if (!room || !roomNumber.value) {
            $("formMessage").textContent =
                "Please select a room type and room number.";
            return;
        }

        if (nights < 1) {
            $("formMessage").textContent =
                "Check-out must be later than check-in.";
            return;
        }

        const payment = document.querySelector(
            'input[name="payment"]:checked'
        );

        if (!payment) {
            $("formMessage").textContent =
                "Please select a payment method.";
            return;
        }

        const roomId = room.ids[roomNumber.value];

        if (!roomId) {
            $("formMessage").textContent =
                "That room could not be recognised. Please pick it again.";
            return;
        }

        $("formMessage").textContent = "";

        const submitButton = form.querySelector('button[type="submit"]');
        const submitLabel = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = "Booking…";

        try {
            const response = await fetch(`${API_BASE}/api/reservations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_id: roomId,
                    check_in: checkIn.value,
                    check_out: checkOut.value,
                    full_name: $("fullName").value.trim(),
                    email: $("email").value.trim(),
                    phone: $("contactNumber").value.trim(),
                    payment_method: payment.value
                })
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                const reason = data.message || `Booking failed (HTTP ${response.status}).`;
                const sentence = reason.endsWith(".") ? reason : `${reason}.`;

                $("formMessage").textContent =
                    response.status === 409
                        ? `${sentence} Please choose another room.`
                        : sentence;

                // Someone else took the room between the check and the submit.
                if (response.status === 409) {
                    refreshAvailability();
                }
                return;
            }

            showReceipt(data.reservation, room, payment.value, nights);
        } catch (error) {
            console.error(error);
            $("formMessage").textContent =
                "Could not reach the booking service. Check your connection and try again.";
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = submitLabel;
        }
    });

    // Fills the receipt with the reservation the API just created.
    function showReceipt(reservation, room, paymentMethod, nights) {
        $("receiptReservationId").textContent = reservation.id;
        $("receiptNotice").textContent =
            `Reservation #${reservation.id} confirmed. Keep this number for check-in.`;

        $("receiptRoomImage").src = room.image;
        $("receiptRoomType").textContent = room.name;
        $("receiptRoomNumber").textContent = roomNumber.value;
        $("receiptFloor").textContent = room.floor;

        $("receiptCheckIn").textContent =
            formatDate(checkIn.value);

        $("receiptCheckOut").textContent =
            formatDate(checkOut.value);

        $("receiptNights").textContent =
            `${nights} Night${nights > 1 ? "s" : ""}`;

        $("receiptGuests").textContent = guests.value;

        $("receiptName").textContent =
            $("fullName").value.trim();

        $("receiptContact").textContent =
            $("contactNumber").value.trim();

        $("receiptEmail").textContent =
            $("email").value.trim();

        $("receiptPayment").textContent = paymentMethod;
        $("receiptTotal").textContent = money(updateTotal());

        overlay.hidden = false;
        document.body.style.overflow = "hidden";
        $("closeConfirmation").focus();

        // The room is booked now, so update the list behind the modal.
        refreshAvailability();
    }

    function closeConfirmation() {
        overlay.hidden = true;
        document.body.style.overflow = "";
    }

    $("closeConfirmation").addEventListener(
        "click",
        closeConfirmation
    );

    overlay.addEventListener("click", function (event) {
        if (event.target === overlay) {
            closeConfirmation();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !overlay.hidden) {
            closeConfirmation();
        }
    });

    $("printReceipt").addEventListener("click", function () {
        window.print();
    });

    // Load the catalog, then honour ?type=... links from rooms.html.
    loadRooms()
        .then(catalog => {
            rooms = catalog;

            // Fill the dropdown from the catalog, keeping the placeholder option.
            while (roomType.options.length > 1) {
                roomType.remove(1);
            }

            Object.entries(rooms).forEach(([slug, room]) => {
                const option = document.createElement("option");
                option.value = slug;
                option.textContent = room.name;
                roomType.appendChild(option);
            });

            const urlParams = new URLSearchParams(window.location.search);
            const typeParam = urlParams.get("type");

            if (typeParam && rooms[typeParam]) {
                roomType.value = typeParam;
                roomType.dispatchEvent(new Event("change"));
            }

            if (roomType.options.length <= 1) {
                $("formMessage").textContent =
                    "No rooms are available right now. Please try again later.";
            }
        })
        .catch(error => {
            console.error(error);
            $("formMessage").textContent =
                "Could not load the rooms. Check your connection and reload the page.";
        });

});