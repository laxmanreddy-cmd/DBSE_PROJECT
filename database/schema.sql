CREATE DATABASE IF NOT EXISTS expense_splitter;
USE expense_splitter;

DROP TABLE IF EXISTS settlements,expense_splits,expenses,group_members,groups_tbl,users;

CREATE TABLE users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,name VARCHAR(80) NOT NULL,email VARCHAR(120) NOT NULL UNIQUE
);
CREATE TABLE groups_tbl (
  group_id INT PRIMARY KEY AUTO_INCREMENT,name VARCHAR(100) NOT NULL,description VARCHAR(255),budget DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE group_members (
  group_id INT NOT NULL,user_id INT NOT NULL,role ENUM('admin','member') DEFAULT 'member',joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id,user_id),FOREIGN KEY(group_id) REFERENCES groups_tbl(group_id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE TABLE expenses (
  expense_id INT PRIMARY KEY AUTO_INCREMENT,group_id INT NOT NULL,payer_id INT NOT NULL,description VARCHAR(160) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,category VARCHAR(40) DEFAULT 'Other',split_type ENUM('equal','exact','percentage') DEFAULT 'equal',
  expense_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(group_id) REFERENCES groups_tbl(group_id) ON DELETE CASCADE,
  FOREIGN KEY(payer_id) REFERENCES users(user_id),INDEX(group_id),INDEX(payer_id)
);
CREATE TABLE expense_splits (
  split_id INT PRIMARY KEY AUTO_INCREMENT,expense_id INT NOT NULL,user_id INT NOT NULL,share DECIMAL(12,2) NOT NULL,
  FOREIGN KEY(expense_id) REFERENCES expenses(expense_id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(user_id),
  UNIQUE KEY one_share(expense_id,user_id),INDEX(user_id)
);
CREATE TABLE settlements (
  settlement_id INT PRIMARY KEY AUTO_INCREMENT,group_id INT NOT NULL,from_user_id INT NOT NULL,to_user_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(group_id) REFERENCES groups_tbl(group_id) ON DELETE CASCADE,FOREIGN KEY(from_user_id) REFERENCES users(user_id),
  FOREIGN KEY(to_user_id) REFERENCES users(user_id),INDEX(group_id)
);

INSERT INTO users(name,email) VALUES
('Laxman Reddy','laxman@example.com'),('Megha Sai','megha@example.com'),('Surya Prakash','surya@example.com'),('Ananya Rao','ananya@example.com');
INSERT INTO groups_tbl(name,description,budget) VALUES
('Campus Crew','College friends — shared food, travel and project expenses',25000);
INSERT INTO group_members(group_id,user_id,role) VALUES (1,1,'admin'),(1,2,'member'),(1,3,'member'),(1,4,'member');
INSERT INTO expenses(group_id,payer_id,description,amount,category,split_type) VALUES
(1,1,'Team dinner',2400,'Food','equal'),(1,2,'Cab to college',800,'Travel','equal'),(1,3,'Project supplies',1600,'Study','equal');
INSERT INTO expense_splits(expense_id,user_id,share) VALUES
(1,1,600),(1,2,600),(1,3,600),(1,4,600),(2,1,200),(2,2,200),(2,3,200),(2,4,200),
(3,1,400),(3,2,400),(3,3,400),(3,4,400);
