CREATE DATABASE splitmaster;
USE splitmaster;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE groups_master (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL
);

CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    paid_by INT NOT NULL,
    group_id INT NOT NULL,
    expense_date DATE DEFAULT (CURRENT_DATE),
    FOREIGN KEY (paid_by) REFERENCES users(id),
    FOREIGN KEY (group_id) REFERENCES groups_master(id)
);

CREATE TABLE expense_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_id INT NOT NULL,
    user_id INT NOT NULL,
    share_amount DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (expense_id) REFERENCES expenses(id)
        ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE settlements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    from_user INT NOT NULL,
    to_user INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (from_user) REFERENCES users(id),
    FOREIGN KEY (to_user) REFERENCES users(id)
);

INSERT INTO users (name, email) VALUES
('Laxman', 'laxman@gmail.com'),
('Arjun', 'arjun@gmail.com'),
('Neha', 'neha@gmail.com'),
('Rahul', 'rahul@gmail.com');

INSERT INTO groups_master (group_name) VALUES
('Goa Trip'),
('Flat 4B'),
('Friends');

SELECT * FROM users;
SELECT * FROM groups_master;
SELECT * FROM expenses;
SELECT * FROM expense_members;
SELECT * FROM settlements;