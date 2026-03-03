const express = require('express');
const cors = require('cors');
const app = express();

// Allow requests from any Vercel deployment (and localhost for dev)
app.use(cors({
    origin: [
        /\.vercel\.app$/,      // any *.vercel.app subdomain
        'http://localhost:3000' // local dev
    ],
    methods: ['GET']
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
