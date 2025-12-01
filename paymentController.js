const db = require('../config/database');
const crypto = require('crypto');

// GET /enrollment/{id}/fees_information
exports.getFeesInformation = (req, res) => {
    const enrollmentId = req.params.id;

    db.get(`SELECT * FROM fees_information WHERE enrollment_id = ?`, [enrollmentId], (err, feeRecord) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!feeRecord) return res.status(404).json({ error: "Enrollment not found" });

        db.get(`SELECT SUM(amount) as total_paid FROM payment_transactions 
                WHERE enrollment_id = ? AND status_code = 'COMPLETED'`, [enrollmentId], (err, row) => {
            
            const totalPaid = row.total_paid || 0;
            const remainingBalance = feeRecord.total_assessed - totalPaid;
            
            let status = "Unpaid";
            if (remainingBalance <= 0) status = "Paid in Full";
            else if (totalPaid > 0) status = "Partial";

            const miscTotal = feeRecord.cultural_fee + feeRecord.internet_fee + 
                              feeRecord.medical_dental_fee + feeRecord.registration_fee + 
                              feeRecord.school_pub_fee + feeRecord.id_validation_fee;

            res.json({
                enrollment_id: feeRecord.enrollment_id,
                student_id: feeRecord.student_id,
                term: feeRecord.term,
                currency: feeRecord.currency,
                summary: {
                    total_assessed_fees: feeRecord.total_assessed,
                    total_amount_paid: totalPaid,
                    remaining_balance: remainingBalance,
                    payment_status: status
                },
                fees_details: {
                    tuition_fee: feeRecord.tuition_fee,
                    computer_lab_fee: feeRecord.computer_lab_fee,
                    athletic_fee: feeRecord.athletic_fee,
                    library_fee: feeRecord.library_fee,
                    miscellaneous_fees: miscTotal
                }
            });
        });
    });
};

// POST /enrollment/{id}/payment_transactions
exports.handlePaymentTransaction = (req, res) => {
    const enrollmentId = req.params.id;
    
    // CASE A: Initiate Payment
    if (req.body.amount) {
        const { amount, payment_method, description } = req.body;
        const transactionId = "TXN-" + Math.floor(Math.random() * 100000000);
        const timestamp = new Date().toISOString();

        const sql = `INSERT INTO payment_transactions 
                    (transaction_id, enrollment_id, amount, currency, payment_method, status_code, description, transaction_timestamp) 
                    VALUES (?, ?, ?, 'PHP', ?, 'PENDING', ?, ?)`;

        db.run(sql, [transactionId, enrollmentId, amount, payment_method, description, timestamp], function(err) {
            if (err) return res.status(500).json({ error: err.message });

            res.json({
                transaction_id: transactionId,
                enrollment_id: parseInt(enrollmentId),
                status: "PENDING",
                amount_due: amount,
                payment_gateway_url: `https://gateway.payment.com/checkout?token=${crypto.randomBytes(8).toString('hex')}`,
                timestamp: timestamp
            });
        });
    } 
    // CASE B: Confirm Payment
    else if (req.body.transaction_id && req.body.status_code) {
        const { transaction_id, gateway_reference, status_code } = req.body;

        const sql = `UPDATE payment_transactions 
                     SET status_code = ?, transaction_ref = ?, transaction_timestamp = CURRENT_TIMESTAMP 
                     WHERE transaction_id = ?`;

        db.run(sql, [status_code, gateway_reference, transaction_id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Transaction not found" });

            res.json({
                transaction_id: transaction_id,
                status: status_code,
                updated_balance: 0.00, // Logic to re-calculate balance could be added here
                message: "Payment successfully recorded."
            });
        });
    } else {
        res.status(400).json({ error: "Invalid request format" });
    }
};

// GET /transactions/{transaction_id}
exports.getTransactionDetails = (req, res) => {
    const txnId = req.params.transaction_id;
    
    const sql = `SELECT pt.*, fi.student_id 
                 FROM payment_transactions pt
                 JOIN fees_information fi ON pt.enrollment_id = fi.enrollment_id
                 WHERE pt.transaction_id = ?`;

    db.get(sql, [txnId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Transaction not found" });

        res.json({
            transaction_id: row.transaction_id,
            date: row.transaction_timestamp,
            student_id: row.student_id,
            amount_paid: row.amount,
            payment_method: row.payment_method,
            reference_number: row.transaction_ref,
            status: row.status_code
        });
    });
};

// GET /enrollment/{id}/transaction_history
exports.getTransactionHistory = (req, res) => {
    const enrollmentId = req.params.id;

    db.all(`SELECT * FROM payment_transactions WHERE enrollment_id = ?`, [enrollmentId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const totalPaid = rows
            .filter(r => r.status_code === 'COMPLETED')
            .reduce((sum, r) => sum + r.amount, 0);

        const transactions = rows.map(r => ({
            transaction_id: r.transaction_id,
            date: r.transaction_timestamp.split(' ')[0], 
            amount: r.amount,
            status: r.status_code,
            type: r.description
        }));

        res.json({
            enrollment_id: parseInt(enrollmentId),
            total_paid: totalPaid,
            transactions: transactions
        });
    });
};