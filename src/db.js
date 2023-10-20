import {config} from 'dotenv';
import postgres from 'postgres';

// Load credentials from .env
config();

const sql = postgres({transform: postgres.camel});

export default sql;
