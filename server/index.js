const express = require('express');
const cors = require('cors');
const app = express();

// Allow requests from specific origin or localhost for dev
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        const isAllowed = allowedOrigins.some(allowed => {
            return allowed === origin;
        });

        if (isAllowed || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
}));

app.use(express.json());

// Health / status endpoint
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', engine: 'Piston API' });
});

// Catch-all: inform callers this server only exposes /api routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found. Client is served from Vercel.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Execution engine: Cloud (Piston API)');
});
