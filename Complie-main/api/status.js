module.exports = (req, res) => {
    res.status(200).json({
        status: 'online',
        engine: 'Piston API',
        note: 'Deployed as Vercel Serverless Function'
    });
};
