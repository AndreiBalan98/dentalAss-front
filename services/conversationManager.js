const logger = require('./logger');

class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.maxConversationAge = 30 * 60 * 1000; // 30 minute
        this.cleanupInterval = 10 * 60 * 1000; // 10 minute
        
        // Pornește curățarea automată
        this.startCleanupTimer();
    }
    
    createConversation(callId, mode, metadata = {}) {
        const conversation = {
            id: callId,
            mode: mode,
            messages: [],
            startTime: new Date(),
            lastActivity: new Date(),
            metadata: {
                userAgent: metadata.userAgent || '',
                ip: metadata.ip || '',
                ...metadata
            },
            stats: {
                messageCount: 0,
                audioProcessingTime: 0,
                totalDuration: 0
            }
        };
        
        this.conversations.set(callId, conversation);
        
        logger.info(`CONV_START | Mode: ${mode} | ID: ${callId} | IP: ${metadata.ip || 'unknown'}`);
        console.log(`🆕 Conversație nouă creată: ${callId} (${mode})`);
        
        return conversation;
    }
    
    getConversation(callId) {
        const conversation = this.conversations.get(callId);
        
        if (conversation) {
            // Actualizează timpul ultimei activități
            conversation.lastActivity = new Date();
        }
        
        return conversation;
    }
    
    addMessage(callId, role, content, metadata = {}) {
        const conversation = this.getConversation(callId);
        
        if (!conversation) {
            throw new Error(`Conversația cu ID-ul ${callId} nu există`);
        }
        
        const message = {
            role: role, // 'user' sau 'assistant'
            content: content,
            timestamp: new Date(),
            metadata: metadata
        };
        
        conversation.messages.push(message);
        conversation.stats.messageCount++;
        conversation.lastActivity = new Date();
        
        // Log mesajul
        const logType = role === 'user' ? 'USER_MSG' : 'AI_MSG';
        logger.info(`${logType} | ID: ${callId} | "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
        
        return message;
    }
    
    updateConversationStats(callId, stats) {
        const conversation = this.getConversation(callId);
        
        if (conversation) {
            Object.assign(conversation.stats, stats);
            conversation.lastActivity = new Date();
        }
        
        return conversation;
    }
    
    endConversation(callId, reason = 'normal') {
        const conversation = this.conversations.get(callId);
        
        if (conversation) {
            const duration = Date.now() - conversation.startTime.getTime();
            
            logger.info(`CONV_END | ID: ${callId} | Reason: ${reason} | Duration: ${Math.round(duration / 1000)}s | Messages: ${conversation.stats.messageCount}`);
            
            console.log(`🔚 Conversație încheiată: ${callId}`);
            console.log(`📊 Statistici:`, {
                duration: `${Math.round(duration / 1000)}s`,
                messages: conversation.stats.messageCount,
                mode: conversation.mode
            });
            
            // Opțional: salvează conversația în baza de date aici
            this.archiveConversation(conversation);
            
            this.conversations.delete(callId);
        }
    }
    
    archiveConversation(conversation) {
        // Pentru viitor: salvează conversația în baza de date
        // Momentan doar logăm
        logger.info(`CONV_ARCHIVE | ID: ${conversation.id} | Messages: ${conversation.messages.length}`);
    }
    
    getConversationSummary() {
        const active = this.conversations.size;
        const modes = {};
        
        for (const [_, conv] of this.conversations) {
            modes[conv.mode] = (modes[conv.mode] || 0) + 1;
        }
        
        return {
            activeConversations: active,
            modeDistribution: modes,
            timestamp: new Date()
        };
    }
    
    cleanupOldConversations() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [callId, conversation] of this.conversations) {
            const age = now - conversation.lastActivity.getTime();
            
            if (age > this.maxConversationAge) {
                this.endConversation(callId, 'timeout');
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            logger.info(`CLEANUP | Cleaned ${cleanedCount} old conversations`);
            console.log(`🧹 Curățat ${cleanedCount} conversații vechi`);
        }
        
        return cleanedCount;
    }
    
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupOldConversations();
        }, this.cleanupInterval);
        
        logger.info('CLEANUP_TIMER | Started automatic cleanup timer');
    }
    
    // Metode pentru debugging și monitoring
    getAllConversations() {
        return Array.from(this.conversations.entries()).map(([id, conv]) => ({
            id,
            mode: conv.mode,
            messageCount: conv.messages.length,
            startTime: conv.startTime,
            lastActivity: conv.lastActivity,
            stats: conv.stats
        }));
    }
    
    getConversationById(callId) {
        return this.conversations.get(callId);
    }
    
    forceCleanup() {
        const count = this.cleanupOldConversations();
        return count;
    }
}

// Singleton instance
const conversationManager = new ConversationManager();

module.exports = conversationManager;