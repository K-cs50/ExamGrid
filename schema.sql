CREATE DATABASE IF NOT EXISTS invigilator_db;
USE invigilator_db;

DROP TABLE IF EXISTS replacement_log, allocation, unavailability, session_hall, exam_session, hall, faculty, department;

CREATE TABLE department (
  dept_id   VARCHAR(10) PRIMARY KEY,
  dept_name VARCHAR(60) NOT NULL
);

CREATE TABLE faculty (
  faculty_id  INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(60) NOT NULL,
  dept_id     VARCHAR(10) NOT NULL,
  base_duties INT NOT NULL DEFAULT 0,          -- duties from earlier cycles--
  FOREIGN KEY (dept_id) REFERENCES department(dept_id)
);

CREATE TABLE hall (
  hall_id   INT PRIMARY KEY AUTO_INCREMENT,
  hall_name VARCHAR(20) NOT NULL,
  capacity  INT NOT NULL
);

CREATE TABLE exam_session (
  session_id INT PRIMARY KEY AUTO_INCREMENT,
  subject    VARCHAR(80) NOT NULL,
  dept_id    VARCHAR(10) NOT NULL,
  exam_date  DATE NOT NULL,
  shift      ENUM('Forenoon','Afternoon') NOT NULL,
  FOREIGN KEY (dept_id) REFERENCES department(dept_id)
);

CREATE TABLE session_hall (
  session_hall_id      INT PRIMARY KEY AUTO_INCREMENT,
  session_id           INT NOT NULL,
  hall_id              INT NOT NULL,
  students_count       INT NOT NULL,
  invigilators_needed  INT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES exam_session(session_id),
  FOREIGN KEY (hall_id) REFERENCES hall(hall_id)
);

CREATE TABLE unavailability (
  faculty_id INT NOT NULL,
  session_id INT NOT NULL,
  PRIMARY KEY (faculty_id, session_id),
  FOREIGN KEY (faculty_id) REFERENCES faculty(faculty_id),
  FOREIGN KEY (session_id) REFERENCES exam_session(session_id)
);

-- a reserve has session_hall_id NULL until called in
CREATE TABLE allocation (
  alloc_id        INT PRIMARY KEY AUTO_INCREMENT,
  session_id      INT NOT NULL,
  session_hall_id INT NULL,
  faculty_id      INT NOT NULL,
  role            ENUM('PRIMARY','RESERVE') NOT NULL DEFAULT 'PRIMARY',
  status          ENUM('ASSIGNED','ABSENT') NOT NULL DEFAULT 'ASSIGNED',
  UNIQUE KEY no_clash (session_id, faculty_id),  -- one person, one place per session
  FOREIGN KEY (session_id) REFERENCES exam_session(session_id),
  FOREIGN KEY (session_hall_id) REFERENCES session_hall(session_hall_id),
  FOREIGN KEY (faculty_id) REFERENCES faculty(faculty_id)
);

CREATE TABLE replacement_log (
  log_id                 INT PRIMARY KEY AUTO_INCREMENT,
  session_id             INT NOT NULL,
  session_hall_id        INT,
  absent_faculty_id      INT NOT NULL,
  replacement_faculty_id INT NOT NULL,
  replaced_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------- seed data ----------
INSERT INTO department VALUES
 ('CSE','Computer Science'),('ECE','Electronics'),('EEE','Electrical'),
 ('MECH','Mechanical'),('CIVIL','Civil'),('MBA','Management');

INSERT INTO faculty (name, dept_id, base_duties) VALUES
 ('Dr. Rao','ECE',3),('Prof. Iyer','ECE',2),('Dr. Menon','MECH',4),('Prof. Das','MECH',1),
 ('Dr. Khan','EEE',2),('Prof. Nair','EEE',3),('Dr. Shah','MBA',1),('Prof. Joshi','MBA',2),
 ('Dr. Pillai','CIVIL',0),('Prof. Bose','CIVIL',3),('Dr. Verma','CSE',2),
 ('Prof. Singh','CSE',1),('Dr. Reddy','CSE',0),('Prof. Fatima','EEE',1);

INSERT INTO hall (hall_name, capacity) VALUES ('H-101',60),('H-102',60),('H-201',30),('H-202',30);

INSERT INTO exam_session (subject, dept_id, exam_date, shift) VALUES
 ('Data Structures','CSE','2026-11-12','Forenoon'),
 ('Signals and Systems','ECE','2026-11-12','Afternoon'),
 ('Thermodynamics','MECH','2026-11-13','Forenoon');

INSERT INTO session_hall (session_id, hall_id, students_count, invigilators_needed) VALUES
 (1,1,60,2),(1,2,60,2),(1,3,30,1),
 (2,1,60,2),(2,4,30,1),
 (3,2,60,2),(3,3,30,1),(3,4,30,1);

INSERT INTO unavailability VALUES (1,1);  -- Dr. Rao is unavailable for session 1
