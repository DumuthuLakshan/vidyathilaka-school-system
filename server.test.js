const request = require('supertest');
const app = require('./server'); // Imports your server

describe('Vidyathilaka College API Master Test Suite', () => {
    
    const testStudentId = 99999; 
    const testFatherNic = '999999999V';
    const testMotherNic = '888888888V';
    const academicYear = '2026';

    // 1. Test Dynamic Fetchers
    it('GET /api/classes - should fetch all classes', async () => {
        const res = await request(app).get('/api/classes');
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/subjects - should fetch all subjects', async () => {
        const res = await request(app).get('/api/subjects');
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // 2. Test Registration (Creates Student & Parents)
    it('POST /api/register-student - should register a new student', async () => {
        const res = await request(app)
            .post('/api/register-student')
            .field('student_id', testStudentId)
            .field('first_name', 'TestName')
            .field('last_name', 'TestSurname')
            .field('date_of_birth', '2010-01-01')
            .field('gender', 'Male')
            .field('address', '123 Cloud Street')
            .field('father_nic', testFatherNic)
            .field('father_name', 'Cloud Father')
            .field('father_phone', '0770000000')
            .field('father_address', '123 Cloud Street')
            .field('mother_nic', testMotherNic)
            .field('mother_name', 'Cloud Mother')
            .field('mother_phone', '0770000001')
            .field('mother_address', '123 Cloud Street')
            .field('academic_year', academicYear)
            .field('class_id', 1); // Assuming Class 1 exists

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // 3. Test Fetching Data
    it('GET /api/student/:id - should fetch basic student info', async () => {
        const res = await request(app).get(`/api/student/${testStudentId}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.first_name).toBe('TestName');
    });

    it('GET /api/parent/:nic - should fetch parent info', async () => {
        const res = await request(app).get(`/api/parent/${testFatherNic}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.parent_name).toBe('Cloud Father');
    });

    // 4. Test Updates
    it('POST /api/update-student-info - should update student address', async () => {
        const res = await request(app).post('/api/update-student-info').send({
            student_id: testStudentId,
            first_name: 'TestName',
            last_name: 'TestSurname',
            address: '456 Updated Ave'
        });
        expect(res.body.success).toBe(true);
    });

    it('POST /api/update-status - should update status to Active', async () => {
        const res = await request(app).post('/api/update-status').send({
            student_id: testStudentId,
            new_status: 'Active'
        });
        expect(res.body.success).toBe(true);
    });

    // 5. Test Exam Results
    it('POST /api/enter-results - should insert exam marks', async () => {
        const res = await request(app).post('/api/enter-results').send({
            student_id: testStudentId,
            academic_year: academicYear,
            subject_id: 1,
            term: '1 Term',
            marks: 95
        });
        expect(res.body.success).toBe(true);
    });

    // 6. Test Full Profile Aggregation
    it('GET /api/student-full-profile/:id - should fetch complete profile', async () => {
        const res = await request(app).get(`/api/student-full-profile/${testStudentId}`);
        expect(res.body.success).toBe(true);
        expect(res.body.student.address).toBe('456 Updated Ave');
        expect(res.body.parents.length).toBe(2);
        expect(res.body.exams.length).toBe(1);
        expect(res.body.enrollment).not.toBeNull();
    });

    // 7. Test Automated Promotion
    it('POST /api/school-wide-promotion - should execute successfully', async () => {
        const res = await request(app).post('/api/school-wide-promotion').send({
            current_academic_year: academicYear,
            new_academic_year: '2027'
        });
        // Even if it promotes 0 students (because test classes might not perfectly align), 
        // the query itself should not throw a 500 error.
        expect(res.statusCode).toBe(200); 
        expect(res.body.success).toBe(true);
    });

    // 8. Test Clean Up (Deletions)
    it('POST /api/delete-exam - should delete specific exam mark', async () => {
        const res = await request(app).post('/api/delete-exam').send({
            student_id: testStudentId,
            academic_year: academicYear,
            subject_id: 1,
            term: '1 Term'
        });
        expect(res.body.success).toBe(true);
    });

    it('DELETE /api/delete-student/:id - should cascade delete the student completely', async () => {
        const res = await request(app).delete(`/api/delete-student/${testStudentId}`);
        expect(res.body.success).toBe(true);
    });

    it('GET /api/student-full-profile/:id - should return 404 after deletion', async () => {
        const res = await request(app).get(`/api/student-full-profile/${testStudentId}`);
        expect(res.statusCode).toBe(404);
    });

    // Clean up parents manually since they aren't auto-deleted to prevent breaking sibling links
    it('DELETE /api/delete-parent/:nic - should delete parents', async () => {
        await request(app).delete(`/api/delete-parent/${testFatherNic}`);
        const res = await request(app).delete(`/api/delete-parent/${testMotherNic}`);
        expect(res.body.success).toBe(true);
    });
});