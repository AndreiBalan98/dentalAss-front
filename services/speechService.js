const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

class SpeechService {
    constructor() {
        // Configurare Google Cloud credentials
        const credentials = this.getCredentials();
        
        // Initialize clients
        this.speechClient = new speech.SpeechClient(credentials);
        this.ttsClient = new textToSpeech.TextToSpeechClient(credentials);
        
        // Configurări default
        this.config = {
            sampleRateHertz: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
            languageCode: process.env.AUDIO_LANGUAGE_CODE || 'ro-RO',
            ttsVoiceName: process.env.TTS_VOICE_NAME || 'ro-RO-Standard-A',
            outputDir: process.env.OUTPUT_DIR || 'uploads/responses'
        };
        
        logger.info('SpeechService initialized with config:', this.config);
    }
    
    getCredentials() {
        // Opțiunea 1: Service Account Key File (recomandat pentru producție)
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            return {
                keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
            };
        }
        
        // Opțiunea 2: API Key (mai simplu pentru dezvoltare)
        if (process.env.GOOGLE_CLOUD_API_KEY) {
            return {
                apiKey: process.env.GOOGLE_CLOUD_API_KEY
            };
        }
        
        // Opțiunea 3: Variabile de environment pentru service account
        if (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.GOOGLE_CLOUD_PRIVATE_KEY) {
            return {
                projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
                credentials: {
                    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
                    private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n')
                }
            };
        }
        
        logger.warn('Nu s-au găsit credențiale Google Cloud. Se va folosi autentificarea default.');
        return {};
    }
    
    async speechToText(audioBuffer, callId) {
        const startTime = Date.now();
        
        try {
            logger.audio('STT_START', callId, `Buffer size: ${audioBuffer.length} bytes`);
            
            // Configurarea request-ului pentru Speech-to-Text
            const request = {
                audio: {
                    content: audioBuffer.toString('base64')
                },
                config: {
                    encoding: this.detectAudioEncoding(audioBuffer),
                    sampleRateHertz: this.config.sampleRateHertz,
                    languageCode: this.config.languageCode,
                    enableAutomaticPunctuation: true,
                    model: 'latest_short', // Optimizat pentru conversații scurte
                    useEnhanced: true
                }
            };
            
            // Apelul către Google Cloud Speech-to-Text
            const [response] = await this.speechClient.recognize(request);
            
            const transcription = response.results
                .map(result => result.alternatives[0].transcript)
                .join(' ')
                .trim();
            
            const duration = Date.now() - startTime;
            
            if (transcription) {
                logger.audio('STT_SUCCESS', callId, `"${transcription}" | Duration: ${duration}ms`);
                logger.performance('STT', duration, `Text length: ${transcription.length}`);
            } else {
                logger.audio('STT_EMPTY', callId, `No speech detected | Duration: ${duration}ms`);
            }
            
            return {
                success: true,
                transcript: transcription,
                confidence: response.results[0]?.alternatives[0]?.confidence || 0,
                processingTime: duration
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.errorWithContext(error, {
                action: 'speechToText',
                callId,
                duration,
                bufferSize: audioBuffer.length
            });
            
            return {
                success: false,
                error: error.message,
                processingTime: duration
            };
        }
    }
    
    async textToSpeech(text, callId) {
        const startTime = Date.now();
        
        try {
            logger.audio('TTS_START', callId, `Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
            
            // Configurarea request-ului pentru Text-to-Speech
            const request = {
                input: { text: text },
                voice: {
                    languageCode: this.config.languageCode,
                    name: this.config.ttsVoiceName,
                    ssmlGender: 'FEMALE'
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: 1.0,
                    pitch: 0.0,
                    volumeGainDb: 0.0
                }
            };
            
            // Apelul către Google Cloud Text-to-Speech
            const [response] = await this.ttsClient.synthesizeSpeech(request);
            
            // Generează nume unic pentru fișierul audio
            const filename = `response_${callId}_${uuidv4()}.mp3`;
            const filepath = path.join(this.config.outputDir, filename);
            
            // Salvează fișierul audio
            await fs.writeFile(filepath, response.audioContent, 'binary');
            
            const duration = Date.now() - startTime;
            const audioSize = response.audioContent.length;
            
            logger.audio('TTS_SUCCESS', callId, `File: ${filename} | Size: ${audioSize} bytes | Duration: ${duration}ms`);
            logger.performance('TTS', duration, `Text length: ${text.length}, Audio size: ${audioSize}`);
            
            return {
                success: true,
                audioPath: filepath,
                audioUrl: `/uploads/responses/${filename}`,
                filename: filename,
                audioSize: audioSize,
                processingTime: duration
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.errorWithContext(error, {
                action: 'textToSpeech',
                callId,
                duration,
                textLength: text.length
            });
            
            return {
                success: false,
                error: error.message,
                processingTime: duration
            };
        }
    }
    
    detectAudioEncoding(audioBuffer) {
        // Detectează encoding-ul bazat pe header-ul fișierului
        const header = audioBuffer.slice(0, 12).toString('ascii');
        
        if (header.includes('WEBM')) {
            return 'WEBM_OPUS';
        } else if (header.includes('RIFF')) {
            return 'LINEAR16'; // WAV
        } else if (header.includes('OggS')) {
            return 'OGG_OPUS';
        } else if (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0) {
            return 'MP3';
        } else {
            // Default fallback
            logger.warn('Encoding necunoscut, folosesc WEBM_OPUS ca default');
            return 'WEBM_OPUS';
        }
    }
    
    async cleanupOldFiles() {
        try {
            const files = await fs.readdir(this.config.outputDir);
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 ore
            let deletedCount = 0;
            
            for (const file of files) {
                const filepath = path.join(this.config.outputDir, file);
                const stats = await fs.stat(filepath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.remove(filepath);
                    deletedCount++;
                }
            }
            
            if (deletedCount > 0) {
                logger.info(`CLEANUP | Deleted ${deletedCount} old audio files`);
            }
            
            return deletedCount;
        } catch (error) {
            logger.error('Error during audio cleanup:', error);
            return 0;
        }
    }
    
    // Test connectivity
    async testConnection() {
        try {
            // Test simplu pentru a verifica conectivitatea
            const testText = 'Test';
            const result = await this.textToSpeech(testText, 'test');
            
            if (result.success) {
                // Șterge fișierul de test
                await fs.remove(result.audioPath);
                logger.info('Google Cloud Speech services test: SUCCESS');
                return true;
            } else {
                logger.error('Google Cloud Speech services test: FAILED', result.error);
                return false;
            }
        } catch (error) {
            logger.error('Google Cloud Speech services test: ERROR', error);
            return false;
        }
    }
}

// Cleanup automat la fiecare 6 ore
const speechService = new SpeechService();
setInterval(() => {
    speechService.cleanupOldFiles();
}, 6 * 60 * 60 * 1000);

module.exports = speechService;