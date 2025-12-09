const db = require("../db");

// USER MODEL
const User = {

    // CREATE NEW USER
    createUser: (username, email, password, role, callback) => {
        const sql = `
            INSERT INTO users (user_name, email, password, rating, created_at, role)
            VALUES (?, ?, ?, 0, NOW(), ?)
        `;
        db.query(sql, [username, email, password, role], callback);
    },

    // LOGIN USER (NOW USES EMAIL + PASSWORD)
    loginUser: (email, password, callback) => {
        const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
        db.query(sql, [email, password], (err, results) => {
            if (err) return callback(err, null);
            if (results.length === 0) return callback(null, null); // No user found
            callback(null, results[0]); // return user object
        });
    }

};

module.exports = User;
