const express = require("express");
const app = express();
const path = require("path");
require("dotenv").config();

// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// View engine (EJS)
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Controllers
const userController = require("./controllers/userController");

// ROUTES
app.get("/", userController.showLoginPage);
app.get("/register", userController.showRegisterPage);

//  ADD THIS ROUTE FOR SUCCESSFUL LOGIN 
app.get("/index", (req, res) => {
    res.render("index"); // Make sure index.ejs exists
});

app.post("/login", userController.loginUser);
app.post("/register", userController.registerUser);

// Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
