const express = require("express");
const mysql = require("mysql");
const app = express();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const PORT = 3000;

app.use(bodyParser.json());

const JWT_SECRET = "SECRET";

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "password",
  database: "railway",
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err);
  } else {
    console.log("Connected to MySQL database");
  }
});

app.post("/api/signup", (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res
      .status(400)
      .json({ error: "Please provide all required fields." });
  }

  const checkDuplicateQuery =
    "SELECT * FROM Users WHERE username = ? OR email = ?";
  db.query(checkDuplicateQuery, [username, email], (err, results) => {
    if (err) {
      console.error("Error querying the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length > 0) {
      return res
        .status(409)
        .json({ error: "Username or email already exists." });
    }

    bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
      if (hashErr) {
        console.error("Error hashing password:", hashErr);
        return res.status(500).json({ error: "Password hashing error" });
      }

      const insertUserQuery =
        "INSERT INTO Users (username, password, email, UserRole) VALUES (?, ?, ?, ?)";
      db.query(
        insertUserQuery,
        [username, hashedPassword, email, "LoginUser"],
        (insertErr, result) => {
          if (insertErr) {
            console.error("Error inserting user into the database:", insertErr);
            return res.status(500).json({ error: "Database error" });
          }

          res.status(200).json({
            status: "Account successfully created",
            status_code: 200,
            user_id: result.insertId,
          });
        }
      );
    });
  });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      status: "Please provide both username and password.",
      status_code: 400,
    });
  }

  const checkUserQuery = "SELECT * FROM Users WHERE username = ?";
  db.query(checkUserQuery, [username], (err, results) => {
    if (err) {
      console.error("Error querying the database:", err);
      return res
        .status(500)
        .json({ status: "Database error", status_code: 500 });
    }

    if (results.length === 0) {
      return res.status(401).json({
        status: "Incorrect username/password provided. Please retry",
        status_code: 401,
      });
    }

    const user = JSON.parse(JSON.stringify(results[0]));
    bcrypt.compare(password, user.Password, (bcryptErr, passwordMatch) => {
      if (bcryptErr) {
        console.error("Error comparing passwords:", bcryptErr);
        return res
          .status(500)
          .json({ status: "Authentication error", status_code: 500 });
      }

      if (passwordMatch) {
        const token = jwt.sign(
          { userId: user.UserID, username: user.username },
          JWT_SECRET
        );

        return res.status(200).json({
          status: "Login successful",
          status_code: 200,
          user_id: user.UserID,
          access_token: token,
        });
      } else {
        return res.status(401).json({
          status: "Incorrect username/password provided. Please retry",
          status_code: 401,
        });
      }
    });
  });
});

app.post("/api/trains/create", (req, res) => {
  const {
    train_name,
    source,
    destination,
    seat_capacity,
    arrival_time_at_source,
    arrival_time_at_destination,
  } = req.body;

  const insertTrainQuery = `
      INSERT INTO Trains (train_name, source, destination, seat_capacity, arrival_time_at_source, arrival_time_at_destination)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

  db.query(
    insertTrainQuery,
    [
      train_name,
      source,
      destination,
      seat_capacity,
      arrival_time_at_source,
      arrival_time_at_destination,
    ],
    (err, result) => {
      if (err) {
        console.error("Error inserting train into the database:", err);
        return res
          .status(500)
          .json({ message: "Train creation failed", error: err.message });
      }

      res.status(201).json({
        message: "Train added successfully",
        train_id: result.insertId,
      });
    }
  );
});

app.get("/api/trains/availability", (req, res) => {
  const { source, destination } = req.query;

  if (!source || !destination) {
    return res
      .status(400)
      .json({ error: "Both source and destination parameters are required." });
  }

  const fetchTrainsQuery = `SELECT T.TrainID, T.train_name, (T.seat_capacity - IFNULL(B.total_bookings, 0)) AS available_seats
      FROM Trains AS T
      LEFT JOIN (
        SELECT TrainID, SUM(num_of_seats) AS total_bookings
        FROM Bookings
        WHERE source = ? AND destination = ?
        GROUP BY TrainID
      ) AS B ON T.TrainID = B.TrainID
      WHERE T.source = ? AND T.destination = ?`;

  db.query(
    fetchTrainsQuery,
    [source, destination, source, destination],
    (err, results) => {
      if (err) {
        console.error("Error querying the database:", err);
        return res.status(500).json({ error: "Database error" });
      }

      res.status(200).json(results);
    }
  );
});

app.post("/api/trains/:train_id/book", (req, res) => {
  const trainId = req.params.train_id;

  const { user_id, no_of_seats } = req.body;

  if (!user_id || !no_of_seats) {
    return res
      .status(400)
      .json({ error: "Both user_id and no_of_seats are required." });
  }

  const token = req.header("Authorization").replace("Bearer ", "");

  if (!verifyToken(token)) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Invalid or expired token." });
  }

  const insertBookingQuery = `
      INSERT INTO Bookings (UserID, TrainID, num_of_seats)
      VALUES (?, ?, ?)
    `;

  db.query(
    insertBookingQuery,
    [user_id, trainId, no_of_seats],
    (err, result) => {
      if (err) {
        console.error("Error inserting booking into the database:", err);
        return res.status(500).json({ error: "Database error" });
      }

      res.status(201).json({
        message: "Seat booked successfully",
        booking_id: result.insertId,
        seat_numbers: generateSeatNumbers(no_of_seats),
      });
    }
  );
});

function generateSeatNumbers(numOfSeats) {
  const seatNumbers = [];
  for (let i = 1; i <= numOfSeats; i++) {
    seatNumbers.push(i);
  }
  return seatNumbers;
}

app.get("/api/bookings/:booking_id", (req, res) => {
  const bookingId = req.params.booking_id;

  const token = req.header("Authorization").replace("Bearer ", "");

  if (!verifyToken(token)) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Invalid or expired token." });
  }

  const fetchBookingQuery = `
      SELECT B.BookingID, B.TrainID, T.train_name, B.UserID, B.num_of_seats, B.seat_numbers,
             T.arrival_time_at_source, T.arrival_time_at_destination
      FROM Bookings AS B
      INNER JOIN Trains AS T ON B.TrainID = T.TrainID
      WHERE B.BookingID = ?
    `;

  db.query(fetchBookingQuery, [bookingId], (err, results) => {
    if (err) {
      console.error("Error querying the database:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const booking = JSON.parse(JSON.stringify(results[0]));
    res.status(200).json({
      booking_id: booking.BookingID,
      train_id: booking.TrainID,
      train_name: booking.train_name,
      user_id: booking.UserID,
      no_of_seats: booking.num_of_seats,
      seat_numbers: JSON.parse(booking.seat_numbers),
      arrival_time_at_source: booking.arrival_time_at_source,
      arrival_time_at_destination: booking.arrival_time_at_destination,
    });
  });
});

function verifyToken(token) {
  try {
    jwt.verify(token, SECRET_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on PORT ${PORT}`);
});
