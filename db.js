const { Pool } = require('pg');
require('dotenv').config();


const pool = new Pool ({
	database: process.env.database_name,
    port: 5432,
    host: process.env.database_host,
    user: process.env.database_user,
    password: process.env.database_password,

});

module.exports = pool;