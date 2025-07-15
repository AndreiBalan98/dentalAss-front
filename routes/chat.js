const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

const conversationManager = require('../services/conversationManager');
const aiService = require('../services/aiService');
const speechService = require('../services/speechService');
const logger = require('../services/logger');
const { getAvailableModes } = require('../config/systemPrompts');

// Configurează multer pentru upload-ul de fișiere audio
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Acceptă doar fișiere audio
        if (file.mimetype.startsWith('audio/') || file.fieldname === 'audio') {
            cb(null, true);
        } else {
            cb(new Error('Doar fișiere audio sunt permise'), false);
        }
    }
});

// Middleware pentru validarea parametrilor
const validateChatRequest = (req, res, next) => {
    const { callId, mode } = req.body;
    
    if (!callId) {
        return res.status(400).json({
            success: false,
            error: 'callId este obligatoriu'
        });
    }
    
    if (!mode) {
        return res.status(400).json({
            success: false,
            error: 'mode este obligatoriu'
        });
    }
    
    const availableModes = getAvailableModes();
    if (!availableModes.includes(mode)) {
        return res.status(400).json({
            success: false,
            error: `Mode invalid. Moduri disponibile: ${availableModes.join(', ')}`
        });
    }
    
    req.validatedData = { callId, mode };
    next();
};

// Endpoint principal pentru chat
router.post('/', upload.single('audio'), validateChatRequest, async (req, res) => {
    const startTime = Date.now();
    const { callId, mode } = req.validatedData;
    const audioFile = req.file;
    
    try {
        logger.info(`CHAT_REQUEST | ID: ${callId} | Mode: ${mode} | HasAudio: ${!!audioFile} | IP: ${req.ip}`);
        
        // Obține sau creează conversația
        let conversation = conversationManager.getConversation(callId);
        
        if (!conversation) {
            // Conversație nouă
            conversation = conversationManager.createConversation(callId, mode, {
                userAgent: req.get('User-Agent'),
                ip: req.ip
            });
        }
        
        let userMessage = '';
        let transcriptResult = null;
        
        // Procesează audio-ul dacă există
        if (audioFile) {
            logger.audio('PROCESSING_START', callId, `File size: ${audioFile.size} bytes, Type: ${audioFile.mimetype}`);
            
            transcriptResult = await speechService.speechToText(audioFile.buffer, callId);
            
            if (transcriptResult.success && transcriptResult.transcript) {
                userMessage = transcriptResult.transcript;
                
                // Adaugă mesajul utilizatorului în conversație
                conversationManager.addMessage(callId, 'user', userMessage, {
                    confidence: transcriptResult.confidence,
                    processingTime: transcriptResult.processingTime
                });
            } else {
                // Nu s-a detectat vorbire
                return res.json({
                    success: false,
                    error: 'Nu am detectat vorbire clară. Vă rog să încercați din nou.',
                    transcript: null,
                    audioUrl: null
                });
            }
        }
        
        // Obține răspunsul de la AI
        const aiResult = await aiService.getResponse(conversation, callId);
        
        let aiResponse = '';
        let ttsResult = null;
        
        if (aiResult.success) {
            aiResponse = aiResult.response;
            
            // Adaugă răspunsul AI în conversație
            conversationManager.addMessage(callId, 'assistant', aiResponse, {
                model: aiResult.model,
                processingTime: aiResult.processingTime,
                usage: aiResult.usage
            });
            
            // Generează audio pentru răspuns
            ttsResult = await speechService.textToSpeech(aiResponse, callId);
            
        } else {
            // Folosește răspunsul de fallback
            aiResponse = aiResult.fallbackResponse;
            
            // Adaugă răspunsul de fallback în conversație
            conversationManager.addMessage(callId, 'assistant', aiResponse, {
                fallback: true,
                originalError: aiResult.error
            });
            
            // Generează audio și pentru fallback
            ttsResult = await speechService.textToSpeech(aiResponse, callId);
        }
        
        // Actualizează statisticile conversației
        const totalDuration = Date.now() - startTime;
        conversationManager.updateConversationStats(callId, {
            totalDuration: totalDuration,
            audioProcessingTime: (transcriptResult?.processingTime || 0) + (ttsResult?.processingTime || 0)
        });
        
        // Verifică dacă conversația s-a încheiat
        const isEnding = aiService.isConversationEnding(aiResponse);
        
        if (isEnding) {
            // Extrage detaliile programării dacă este cazul
            const appointmentDetails = aiService.extractAppointmentDetails(conversation, mode);
            
            if (appointmentDetails) {
                logger.info(`APPOINTMENT | ID: ${callId} | Details: ${JSON.stringify(appointmentDetails)}`);
            }
            
            // Programează închiderea conversației după un delay
            setTimeout(() => {
                conversationManager.endConversation(callId, 'completed');
            }, 5000); // 5 secunde delay
        }
        
        // Construiește răspunsul
        const response = {
            success: true,
            transcript: userMessage || null,
            response: aiResponse,
            audioUrl: ttsResult?.success ? ttsResult.audioUrl : null,
            conversationEnding: isEnding,
            processingTime: {
                total: totalDuration,
                stt: transcriptResult?.processingTime || 0,
                ai: aiResult.processingTime || 0,
                tts: ttsResult?.processingTime || 0
            }
        };
        
        logger.info(`CHAT_RESPONSE | ID: ${callId} | Success: true | Duration: ${totalDuration}ms`);
        res.json(response);
        
    } catch (error) {
        const totalDuration = Date.now() - startTime;
        
        logger.errorWithContext(error, {
            action: 'chatRequest',
            callId,
            mode,
            hasAudio: !!audioFile,
            duration: totalDuration
        });
        
        res.status(500).json({
            success: false,
            error: 'Eroare internă de server. Vă rog să încercați din nou.',
            processingTime: {
                total: totalDuration
            }
        });
    }
});

// Endpoint pentru resetarea conversației
router.post('/reset', (req, res) => {
    const { callId } = req.body;
    
    if (!callId) {
        return res.status(400).json({
            success: false,
            error: 'callId este obligatoriu'
        });
    }
    
    try {
        conversationManager.endConversation(callId, 'reset');
        
        logger.info(`CHAT_RESET | ID: ${callId}`);
        
        res.json({
            success: true,
            message: 'Conversația a fost resetată'
        });
        
    } catch (error) {
        logger.errorWithContext(error, {
            action: 'resetConversation',
            callId
        });
        
        res.status(500).json({
            success: false,
            error: 'Eroare la resetarea conversației'
        });
    }
});

// Endpoint pentru statistici conversație
router.get('/stats/:callId', (req, res) => {
    const { callId } = req.params;
    
    try {
        const conversation = conversationManager.getConversation(callId);
        
        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'Conversația nu a fost găsită'
            });
        }
        
        res.json({
            success: true,
            stats: {
                id: conversation.id,
                mode: conversation.mode,
                messageCount: conversation.messages.length,
                startTime: conversation.startTime,
                lastActivity: conversation.lastActivity,
                stats: conversation.stats
            }
        });
        
    } catch (error) {
        logger.errorWithContext(error, {
            action: 'getConversationStats',
            callId
        });
        
        res.status(500).json({
            success: false,
            error: 'Eroare la obținerea statisticilor'
        });
    }
});

// Endpoint pentru informații sistem
router.get('/info', (req, res) => {
    try {
        const summary = conversationManager.getConversationSummary();
        const availableModes = getAvailableModes();
        
        res.json({
            success: true,
            info: {
                availableModes: availableModes,
                activeConversations: summary.activeConversations,
                modeDistribution: summary.modeDistribution,
                serverTime: new Date().toISOString(),
                uptime: process.uptime()
            }
        });
        
    } catch (error) {
        logger.errorWithContext(error, {
            action: 'getSystemInfo'
        });
        
        res.status(500).json({
            success: false,
            error: 'Eroare la obținerea informațiilor de sistem'
        });
    }
});

// Error handler pentru multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Fișierul audio este prea mare (max 10MB)'
            });
        }
        
        return res.status(400).json({
            success: false,
            error: `Eroare upload: ${error.message}`
        });
    }
    
    if (error.message === 'Doar fișiere audio sunt permise') {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
    
    next(error);
});

module.exports = router;