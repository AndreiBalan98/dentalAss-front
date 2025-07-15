const axios = require('axios');
const { getSystemPrompt, getPromptName } = require('../config/systemPrompts');
const logger = require('./logger');

class AIService {
    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.model = process.env.OPENROUTER_MODEL || 'microsoft/mai-ds-r1:free';
        this.baseURL = 'https://openrouter.ai/api/v1/chat/completions';
        
        if (!this.apiKey) {
            logger.error('OPENROUTER_API_KEY nu este setat în variabilele de environment!');
            throw new Error('OpenRouter API key is required');
        }
        
        logger.info(`AIService initialized with model: ${this.model}`);
    }
    
    async getResponse(conversation, callId) {
        const startTime = Date.now();
        
        try {
            logger.ai('REQUEST_START', callId, `Mode: ${conversation.mode} | Messages: ${conversation.messages.length}`);
            
            // Construiește mesajele pentru API
            const messages = this.buildMessages(conversation);
            
            // Configurează request-ul
            const requestData = {
                model: this.model,
                messages: messages,
                max_tokens: 500,
                temperature: 0.7,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0
            };
            
            const headers = {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
                'X-Title': 'AI Voice Assistant'
            };
            
            // Trimite request-ul către OpenRouter
            const response = await axios.post(this.baseURL, requestData, { headers });
            
            const duration = Date.now() - startTime;
            const aiResponse = response.data.choices[0].message.content;
            
            // Log success
            logger.ai('REQUEST_SUCCESS', callId, `Response: "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? '...' : ''}" | Duration: ${duration}ms`);
            logger.performance('AI_REQUEST', duration, `Model: ${this.model}, Tokens used: ${response.data.usage?.total_tokens || 'unknown'}`);
            
            // Log usage info dacă este disponibil
            if (response.data.usage) {
                logger.info(`AI_USAGE | ID: ${callId} | Prompt: ${response.data.usage.prompt_tokens} | Completion: ${response.data.usage.completion_tokens} | Total: ${response.data.usage.total_tokens}`);
            }
            
            return {
                success: true,
                response: aiResponse,
                model: this.model,
                processingTime: duration,
                usage: response.data.usage || null
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            // Log error cu detalii
            const errorDetails = {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                responseData: error.response?.data,
                duration
            };
            
            logger.errorWithContext(error, {
                action: 'getAIResponse',
                callId,
                mode: conversation.mode,
                messagesCount: conversation.messages.length,
                ...errorDetails
            });
            
            // Determină tipul de eroare și răspunsul corespunzător
            const fallbackResponse = this.generateFallbackResponse(error, conversation.mode);
            
            return {
                success: false,
                error: error.message,
                fallbackResponse: fallbackResponse,
                processingTime: duration
            };
        }
    }
    
    buildMessages(conversation) {
        const messages = [];
        
        // Adaugă system prompt-ul
        const systemPrompt = getSystemPrompt(conversation.mode);
        messages.push({
            role: 'system',
            content: systemPrompt
        });
        
        // Adaugă mesajele conversației
        if (conversation.messages.length === 0) {
            // Prima interacțiune - trimite mesaj de start
            messages.push({
                role: 'user',
                content: 'START_CONVERSATIE'
            });
        } else {
            // Adaugă toate mesajele existente
            messages.push(...conversation.messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })));
        }
        
        // Limitează numărul de mesaje pentru a evita overflow-ul de context
        const maxMessages = 20; // System prompt + 19 mesaje de conversație
        if (messages.length > maxMessages) {
            // Păstrează system prompt-ul și ultimele N mesaje
            const systemMsg = messages[0];
            const recentMessages = messages.slice(-(maxMessages - 1));
            return [systemMsg, ...recentMessages];
        }
        
        return messages;
    }
    
    generateFallbackResponse(error, mode) {
        // Răspunsuri de fallback bazate pe tipul de eroare și modul conversației
        const fallbackResponses = {
            dental: {
                timeout: "Îmi pare rău, am o problemă tehnică momentan. Vă rog să ne sunați direct la clinică pentru programări urgente.",
                rate_limit: "Sistemul este suprasolicitat. Vă rog să încercați din nou în câteva minute.",
                default: "Am întâmpinat o problemă tehnică. Pentru programări, vă rog să ne sunați direct."
            },
            teleshopping: {
                timeout: "OOPS! Avem o problemă tehnică, dar ofertele noastre INCREDIBILE vă așteaptă! Sunați din nou în câteva minute!",
                rate_limit: "Suntem FOARTE solicitați! Încercați din nou pentru oferte FANTASTICE!",
                default: "Problemă tehnică temporară! Ofertele noastre vă așteaptă!"
            },
            tarot: {
                timeout: "Energiile sunt perturbate momentan... Universul îmi spune să încercați din nou în curând.",
                rate_limit: "Cărțile sunt în meditație... Reveniți în câteva momente pentru înțelepciune.",
                default: "Energiile spirituale sunt blocate temporar. Încercați din nou pentru ghidare."
            }
        };
        
        const modeResponses = fallbackResponses[mode] || fallbackResponses.dental;
        
        // Determină tipul de eroare
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return modeResponses.timeout;
        } else if (error.response?.status === 429) {
            return modeResponses.rate_limit;
        } else {
            return modeResponses.default;
        }
    }
    
    isConversationEnding(message) {
        // Detectează dacă conversația se încheie bazat pe conținutul mesajului
        const endingPhrases = {
            dental: [
                'la revedere',
                'o zi bună',
                'o zi frumoasă',
                'toate cele bune',
                'cu drag',
                'vă mulțumesc pentru apel',
                'vă așteptăm la clinică',
                'ne vedem la programare',
                'v-am programat'
            ],
            teleshopping: [
                'vă mulțumesc pentru comandă',
                'comanda va ajunge',
                'felicitări pentru achiziție',
                'ați făcut alegerea perfectă',
                'la revedere și mulțumiri'
            ],
            tarot: [
                'cărțile au vorbit',
                'aceasta este înțelepciunea',
                'universul v-a ghidat',
                'energia voastră este clarificată',
                'drumul vostru este luminat'
            ]
        };
        
        const lowerMessage = message.toLowerCase();
        
        // Verifică toate frazele de încheiere
        const allPhrases = Object.values(endingPhrases).flat();
        return allPhrases.some(phrase => lowerMessage.includes(phrase));
    }
    
    extractAppointmentDetails(conversation, mode) {
        // Extrage detaliile programării din conversație (pentru modul dental)
        if (mode !== 'dental') {
            return null;
        }
        
        const messages = conversation.messages.map(m => m.content).join('\n').toLowerCase();
        
        // Pattern-uri pentru extragerea informațiilor
        const datePattern = /(\d{1,2})\s*(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)/i;
        const timePattern = /ora?\s*(\d{1,2}):?(\d{2})?/i;
        const servicePattern = /(consultație|detartraj|plombă|extracție|control)/i;
        
        const dateMatch = messages.match(datePattern);
        const timeMatch = messages.match(timePattern);
        const serviceMatch = messages.match(servicePattern);
        
        if (dateMatch || timeMatch) {
            return {
                date: dateMatch ? `${dateMatch[1]} ${dateMatch[2]}` : null,
                time: timeMatch ? `${timeMatch[1]}:${timeMatch[2] || '00'}` : null,
                service: serviceMatch ? serviceMatch[1] : 'Consultație generală',
                confirmed: messages.includes('programat') || messages.includes('confirmat')
            };
        }
        
        return null;
    }
    
    // Test conectivitatea cu OpenRouter
    async testConnection() {
        try {
            const testRequest = {
                model: this.model,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Hello, this is a test.' }
                ],
                max_tokens: 10
            };
            
            const response = await axios.post(this.baseURL, testRequest, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            logger.info('OpenRouter API test: SUCCESS');
            return { success: true, model: this.model };
            
        } catch (error) {
            logger.error('OpenRouter API test: FAILED', error.message);
            return { success: false, error: error.message };
        }
    }
    
    // Statistici despre utilizare
    getUsageStats() {
        return {
            model: this.model,
            apiConfigured: !!this.apiKey,
            baseURL: this.baseURL
        };
    }
}

module.exports = new AIService();