const User = require("../models/userModel");

// SHOW LOGIN PAGE
exports.showLoginPage = (req, res) => {
    res.render("login");
};

// SHOW REGISTER PAGE
exports.showRegisterPage = (req, res) => {
    res.render("register");
};

// REGISTER USER
exports.registerUser = (req, res) => {
    const { username, email, password, role } = req.body;

    User.createUser(username, email, password, role, (err, result) => {
        if (err) {
            console.log(err);
            return res.send("Registration failed.");
        }
        res.redirect("/"); // back to login page
    });
};

// LOGIN USER
exports.loginUser = (req, res) => {
    const { email, password } = req.body;

    User.loginUser(email, password, (err, user) => {
        if (err || !user) {
            return res.send("Invalid email or password");
        }

        // Save user session if you want later
        req.session = user;

        // Redirect to index page after successful login
        res.redirect("/index");
    });
};
