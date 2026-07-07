const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, './uploads/'); },
    filename: (req, file, cb) => { cb(null, req.body.student_id + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // Enter your root password here
    database: 'vidyathilakacollege'
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL Local Server!');
});

// Helper function to run DB queries as Promises (Allows us to do sequential Top-Down logic)
const queryDb = (sql, params) => new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
        if (err) reject(err); else resolve(result);
    });
});

// ==========================================
// DYNAMIC FETCH ROUTES (Future-Proofing)
// ==========================================

// Fetch all classes dynamically
app.get('/api/classes', (req, res) => {
    db.query(`SELECT * FROM classes ORDER BY grade_level ASC, section_name ASC`, (err, results) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: results });
    });
});

// Fetch all subjects dynamically
app.get('/api/subjects', (req, res) => {
    db.query(`SELECT * FROM subjects ORDER BY subject_id ASC`, (err, results) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: results });
    });
});

// ==========================================
// CREATE & UPDATE (Registration & Marks)
// ==========================================

// Enter or Update Exam Results (CRUD: Create & Update)
app.post('/api/enter-results', (req, res) => {
    const { student_id, academic_year, subject_id, term, marks } = req.body;
    const sql = `INSERT INTO exam_results (student_id, academic_year, subject_id, term, marks) 
                 VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE marks = VALUES(marks)`;
    db.query(sql, [student_id, academic_year, subject_id, term, marks], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, message: `Marks saved for Student ID ${student_id}!` });
    });
});

// Register Student & Parents (Includes Parent Addresses)
app.post('/api/register-student', upload.single('studentPhoto'), (req, res) => {
    const student_id = parseInt(req.body.student_id);
    const class_id = parseInt(req.body.class_id);
    
    const { 
        first_name, last_name, date_of_birth, gender, address, academic_year,
        father_nic, father_name, father_phone, father_address,
        mother_nic, mother_name, mother_phone, mother_address
    } = req.body;

    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    const sqlStudent = `INSERT INTO student (student_id, first_name, last_name, date_of_birth, gender, address, photo_url, student_status) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')`;

    db.query(sqlStudent, [student_id, first_name, last_name, date_of_birth, gender, address, photo_url], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Failed to register student. ID might already exist.' });

        const insertParentAndLink = (nic, name, phone, parent_address, relationship, callback) => {
            if (!nic || !name) return callback();
            
            const sqlParent = `INSERT INTO parent (nic, parent_name, phone_number, address) VALUES (?, ?, ?, ?) 
                               ON DUPLICATE KEY UPDATE parent_name = VALUES(parent_name), phone_number = VALUES(phone_number), address = VALUES(address)`;
            
            db.query(sqlParent, [nic, name, phone, parent_address], (err) => {
                if (err) return callback(err);
                db.query(`INSERT INTO student_parent (student_id, nic, relationship) VALUES (?, ?, ?)`, [student_id, nic, relationship], callback);
            });
        };

        insertParentAndLink(father_nic, father_name, father_phone, father_address, 'Father', () => {
            insertParentAndLink(mother_nic, mother_name, mother_phone, mother_address, 'Mother', () => {
                db.query(`INSERT INTO enrollments (student_id, class_id, academic_year) VALUES (?, ?, ?)`, [student_id, class_id, academic_year], () => {
                    res.json({ success: true, message: `Success! Student ${first_name} registered.` });
                });
            });
        });
    });
});

app.post('/api/enroll-student', (req, res) => {
    const { student_id, academic_year, class_id } = req.body;
    db.query(`INSERT INTO enrollments (student_id, class_id, academic_year) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE class_id = VALUES(class_id)`, [student_id, class_id, academic_year], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        res.json({ success: true, message: `Student ID ${student_id} enrolled in class!` });
    });
});

app.post('/api/update-status', (req, res) => {
    const { student_id, new_status } = req.body;
    db.query(`UPDATE student SET student_status = ? WHERE student_id = ?`, [new_status, student_id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Update failed.' });
        res.json({ success: true, message: `Status updated to '${new_status}'.` });
    });
});

// ==========================================
// AUTOMATED SCHOOL-WIDE PROMOTION
// ==========================================
app.post('/api/school-wide-promotion', async (req, res) => {
    const { current_academic_year, new_academic_year } = req.body;

    if (!current_academic_year || !new_academic_year || current_academic_year === new_academic_year) {
        return res.status(400).json({ success: false, message: 'Invalid academic years provided.' });
    }

    try {
        // STEP 1: Graduate Grade 11s (Change status to Alumni)
        await queryDb(`
            UPDATE student s 
            JOIN enrollments e ON s.student_id = e.student_id 
            JOIN classes c ON e.class_id = c.class_id 
            SET s.student_status = 'Alumni' 
            WHERE c.grade_level = 11 AND e.academic_year = ? AND s.student_status = 'Active'
        `, [current_academic_year]);

        // Fetch all classes to dynamically pair grades
        const classes = await queryDb(`SELECT * FROM classes`);
        
        // STEP 2: Promote top-down from Grade 10 down to Grade 6
        for (let grade = 10; grade >= 6; grade--) {
            const currentGradeClasses = classes.filter(c => c.grade_level === grade);
            
            for (let currentClass of currentGradeClasses) {
                // Find the matching section in the next grade (e.g. 10-A -> 11-A)
                const nextClass = classes.find(c => c.grade_level === grade + 1 && c.section_name === currentClass.section_name);
                
                if (nextClass) {
                    await queryDb(`
                        INSERT INTO enrollments (student_id, class_id, academic_year)
                        SELECT e.student_id, ?, ? 
                        FROM enrollments e 
                        JOIN student s ON e.student_id = s.student_id
                        WHERE e.class_id = ? AND e.academic_year = ? AND s.student_status = 'Active'
                        ON DUPLICATE KEY UPDATE class_id = VALUES(class_id)
                    `, [nextClass.class_id, new_academic_year, currentClass.class_id, current_academic_year]);
                }
            }
        }

        res.json({ success: true, message: 'School-wide promotion successfully completed from Grade 11 down to 6!' });
    } catch (error) {
        console.error("Automated Promotion Error:", error);
        res.status(500).json({ success: false, message: 'Server error during automated promotion.' });
    }
});


// ==========================================
// CRUD OPERATIONS (Read, Update, Delete)
// ==========================================

// Read: Get Student Info
app.get('/api/student/:id', (req, res) => {
    db.query(`SELECT first_name, last_name, address FROM student WHERE student_id = ?`, [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ success: false, message: 'Student not found.' });
        res.json({ success: true, data: results[0] });
    });
});

// Read: Get Parent Info by NIC
app.get('/api/parent/:nic', (req, res) => {
    db.query(`SELECT parent_name, phone_number, address FROM parent WHERE nic = ?`, [req.params.nic], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ success: false, message: 'Parent not found.' });
        res.json({ success: true, data: results[0] });
    });
});

// Update: Student
app.post('/api/update-student-info', (req, res) => {
    const { student_id, first_name, last_name, address } = req.body;
    db.query(`UPDATE student SET first_name=?, last_name=?, address=? WHERE student_id=?`, [first_name, last_name, address, student_id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Update failed.' });
        res.json({ success: true, message: 'Student updated!' });
    });
});

// Update: Parent
app.post('/api/update-parent-info', (req, res) => {
    const { nic, parent_name, phone_number, address } = req.body;
    db.query(`UPDATE parent SET parent_name=?, phone_number=?, address=? WHERE nic=?`, [parent_name, phone_number, address, nic], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Update failed.' });
        res.json({ success: true, message: 'Parent details updated!' });
    });
});

// Delete: Student (Cascades manually to bypass restrictive FK constraints)
app.delete('/api/delete-student/:id', (req, res) => {
    const id = req.params.id;
    
    // 1. Delete Exam Results
    db.query(`DELETE FROM exam_results WHERE student_id = ?`, [id], (err) => {
        if (err) console.error("Error deleting exams:", err);
        
        // 2. Delete Enrollments
        db.query(`DELETE FROM enrollments WHERE student_id = ?`, [id], (err) => {
            if (err) console.error("Error deleting enrollments:", err);
            
            // 3. Delete Parent Links
            db.query(`DELETE FROM student_parent WHERE student_id = ?`, [id], (err) => {
                if (err) console.error("Error deleting parent links:", err);
                
                // 4. Finally, Delete the Student
                db.query(`DELETE FROM student WHERE student_id = ?`, [id], (err) => {
                    if (err) {
                        console.error("Error deleting student:", err);
                        return res.status(500).json({ success: false, message: 'Delete failed. Check server console for details.' });
                    }
                    res.json({ success: true, message: 'Student completely deleted.' });
                });
            });
        });
    });
});

// Delete: Exam Mark
app.post('/api/delete-exam', (req, res) => {
    const { student_id, academic_year, subject_id, term } = req.body;
    db.query(`DELETE FROM exam_results WHERE student_id=? AND academic_year=? AND subject_id=? AND term=?`, 
    [student_id, academic_year, subject_id, term], (err, result) => {
        if (err || result.affectedRows === 0) return res.status(500).json({ success: false, message: 'Mark not found or delete failed.' });
        res.json({ success: true, message: 'Exam mark deleted.' });
    });
});

// Delete: Parent Link
app.delete('/api/delete-parent/:nic', (req, res) => {
    db.query(`DELETE FROM parent WHERE nic = ?`, [req.params.nic], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Cannot delete parent (ensure no active student links exist).' });
        res.json({ success: true, message: 'Parent record deleted.' });
    });
});

// 10. Fetch Full Profile
app.get('/api/student-full-profile/:id', (req, res) => {
    const studentId = req.params.id;
    const sqlStudent = `SELECT * FROM student WHERE student_id = ?`;
    const sqlParents = `SELECT p.nic, p.parent_name, p.phone_number, p.address, sp.relationship FROM parent p JOIN student_parent sp ON p.nic = sp.nic WHERE sp.student_id = ?`;
    const sqlExams = `SELECT academic_year, subject_id, term, marks FROM exam_results WHERE student_id = ? ORDER BY academic_year DESC, term ASC, subject_id ASC`;
    const sqlEnrollment = `SELECT class_id, academic_year FROM enrollments WHERE student_id = ? ORDER BY academic_year DESC LIMIT 1`;
    
    db.query(sqlStudent, [studentId], (err, studentRes) => {
        if (err || studentRes.length === 0) return res.status(404).json({ success: false });
        db.query(sqlParents, [studentId], (err, parentsRes) => {
            db.query(sqlExams, [studentId], (err, examsRes) => {
                db.query(sqlEnrollment, [studentId], (err, enrollRes) => {
                    res.json({ success: true, student: studentRes[0], parents: parentsRes || [], exams: examsRes || [], enrollment: enrollRes.length > 0 ? enrollRes[0] : null });
                });
            });
        });
    });
});

// Only listen if run directly (e.g., `node server.js`). 
// If imported by Jest/Supertest, just export the app.
if (require.main === module) {
    app.listen(3000, '0.0.0.0', () => console.log('Server running on Port 3000'));
}
module.exports = app;