require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./services/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servim fișierele audio statice
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Creează directoarele necesare
const createDirectories = async () => {
    const dirs = [
        process.env.UPLOAD_DIR || 'uploads/audio',
        process.env.OUTPUT_DIR || 'uploads/responses'
    ];
    
    for (const dir of dirs) {
        await fs.ensureDir(dir);
    }
};

// Routes
const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'AI Voice Assistant Backend',
        version: '1.0.0',
        endpoints: {
            chat: '/api/chat',
            health: '/health'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
const startServer = async () => {
    try {
        await createDirectories();
        
        app.listen(PORT, () => {
            logger.info(`🚀 Server pornit pe portul ${PORT}`);
            logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`🎤 Google Cloud Speech: ${process.env.GOOGLE_CLOUD_PROJECT_ID ? 'Configurat' : 'Nu este configurat'}`);
            logger.info(`🤖 OpenRouter: ${process.env.OPENROUTER_API_KEY ? 'Configurat' : 'Nu este configurat'}`);
        });
    } catch (error) {
        logger.error('Eroare pornire server:', error);
        process.exit(1);
    }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});