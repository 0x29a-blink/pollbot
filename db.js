const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    database: process.env.database_name,
    port: 5432,
    host: process.env.database_host,
    user: process.env.database_user,
    password: process.env.database_password,
});

const query = async (text, params) => {
    const client = await pool.connect();

    try {
        const result = await client.query(text, params);
        return result;
    } finally {
        client.release();
    }
};

module.exports = {
    query,
    pool,
};
