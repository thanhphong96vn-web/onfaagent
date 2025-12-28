(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    apiUrl: null, // Will be set dynamically
    storageKey: 'chatbot_conversation',
    animationDuration: 300
  };

  // Get bot ID and API URL from script tag
  const scriptTag = document.querySelector('script[data-bot]');
  const botId = scriptTag ? scriptTag.getAttribute('data-bot') : null;
  const apiUrl = scriptTag ? scriptTag.getAttribute('data-api-url') : null;
  
  // Set API URL dynamically
  if (apiUrl) {
    CONFIG.apiUrl = apiUrl;
  } else {
    const scriptSrc = scriptTag ? scriptTag.src : '';
    if (scriptSrc) {
      const scriptUrl = new URL(scriptSrc);
      CONFIG.apiUrl = scriptUrl.origin + '/api/public/chat';
    } else {
      CONFIG.apiUrl = window.location.origin + '/api/public/chat';
    }
  }

  if (!botId) {
    console.error('Chatbot: Bot ID not found. Please add data-bot attribute to the script tag.');
    return;
  }

  // State management
  let isOpen = false;
  let isLoading = false;
  let conversation = [];
  let botSettings = null;
  let analytics = {
    messagesSent: 0,
    sessionStart: Date.now(),
    interactions: 0
  };

  // Load conversation from localStorage
  function loadConversation() {
    try {
      const saved = localStorage.getItem(CONFIG.storageKey + '_' + botId);
      conversation = saved ? JSON.parse(saved) : [];
    } catch (e) {
      conversation = [];
    }
  }

  // Save conversation to localStorage
  function saveConversation() {
    try {
      localStorage.setItem(CONFIG.storageKey + '_' + botId, JSON.stringify(conversation));
    } catch (e) {
      console.warn('Chatbot: Could not save conversation to localStorage');
    }
  }

  // Load bot settings
  async function loadBotSettings() {
    try {
      const response = await fetch(CONFIG.apiUrl.replace('/api/public/chat', '/api/public/bot-settings'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ botId })
      });

      if (response.ok) {
        const data = await response.json();
        botSettings = data;
        console.log('Bot settings loaded:', botSettings);
      } else {
        console.warn('Could not load bot settings, using defaults');
      }
    } catch (error) {
      console.warn('Error loading bot settings:', error);
    }
  }

  // Helper function to adjust color brightness
  function adjustColor(color, amount) {
    const usePound = color[0] === '#';
    const col = usePound ? color.slice(1) : color;
    const num = parseInt(col, 16);
    let r = (num >> 16) + amount;
    let g = (num >> 8 & 0x00FF) + amount;
    let b = (num & 0x0000FF) + amount;
    r = r > 255 ? 255 : r < 0 ? 0 : r;
    g = g > 255 ? 255 : g < 0 ? 0 : g;
    b = b > 255 ? 255 : b < 0 ? 0 : b;
    return (usePound ? '#' : '') + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
  }

  // Analytics tracking
  function trackEvent(event, data = {}) {
    analytics.interactions++;
    console.log('Analytics:', event, { ...data, botId, timestamp: Date.now() });
    
    if (CONFIG.apiUrl) {
      fetch(CONFIG.apiUrl.replace('/api/public/chat', '/api/analytics'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId,
          event,
          data: { ...data, ...analytics },
          timestamp: Date.now(),
          userAgent: navigator.userAgent,
          url: window.location.href
        })
      }).catch(error => {
        console.warn('Analytics error:', error);
      });
    }
  }

  // Create chat widget HTML with sidebar
  function createWidget() {
    const themeColor = botSettings?.themeColor || '#F0B90B';
    const botName = botSettings?.name || 'AI Assistant';
    const welcomeMessage = botSettings?.welcomeMessage || 'Xin chào! Tôi có thể giúp gì cho bạn?';
    
    console.log('Creating advance widget with:', { themeColor, botName, welcomeMessage, botSettings });
    
    const widget = document.createElement('div');
    widget.id = 'chatbot-widget-advance';
    widget.innerHTML = `
      <div class="chatbot-overlay" id="chatbot-overlay"></div>
      <div class="chatbot-sidebar" id="chatbot-sidebar">
        <div class="chatbot-sidebar-header">
          <div class="chatbot-sidebar-title">
            <span class="chatbot-icon">👋</span>
            <span class="chatbot-title-text">${botName}</span>
          </div>
          <div class="chatbot-sidebar-actions">
            <button class="chatbot-action-btn" id="chatbot-search" title="Search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
            </button>
            <button class="chatbot-action-btn" id="chatbot-language" title="Language">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </button>
            <button class="chatbot-action-btn" id="chatbot-fullscreen" title="Fullscreen">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
              </svg>
            </button>
            <button class="chatbot-close-btn" id="chatbot-close">×</button>
          </div>
        </div>
        <div class="chatbot-sidebar-content">
          <div class="chatbot-welcome-section">
            <div class="chatbot-welcome-message">${welcomeMessage}</div>
          </div>
          <div class="chatbot-messages" id="chatbot-messages">
            <!-- Messages will be loaded dynamically -->
          </div>
        </div>
        <div class="chatbot-sidebar-footer">
          <div class="chatbot-input-wrapper">
            <input type="text" id="chatbot-input" placeholder="Nhập tin nhắn..." />
            <button id="chatbot-send" class="chatbot-send-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <button class="chatbot-trigger-btn" id="chatbot-trigger">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
    `;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      #chatbot-widget-advance {
        --chatbot-primary: ${themeColor};
        --chatbot-primary-hover: ${adjustColor(themeColor, -20)};
        --chatbot-primary-light: ${adjustColor(themeColor, 40)};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }

      .chatbot-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9998;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s ease;
      }

      .chatbot-overlay.active {
        opacity: 1;
        visibility: visible;
      }

      .chatbot-sidebar {
        position: fixed;
        top: 0;
        right: -420px;
        width: 420px;
        height: 100vh;
        background: #1a1a1a;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
      }

      .chatbot-sidebar.open {
        right: 0;
      }

      .chatbot-sidebar-header {
        background: #1a1a1a;
        padding: 20px;
        border-bottom: 1px solid #2a2a2a;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .chatbot-sidebar-title {
        display: flex;
        align-items: center;
        gap: 12px;
        color: #fff;
      }

      .chatbot-icon {
        font-size: 24px;
      }

      .chatbot-title-text {
        font-size: 18px;
        font-weight: 600;
        color: #fff;
      }

      .chatbot-sidebar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .chatbot-action-btn {
        background: transparent;
        border: none;
        color: #999;
        cursor: pointer;
        padding: 8px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .chatbot-action-btn:hover {
        background: #2a2a2a;
        color: #fff;
      }

      .chatbot-close-btn {
        background: transparent;
        border: none;
        color: #999;
        cursor: pointer;
        font-size: 28px;
        line-height: 1;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.2s;
      }

      .chatbot-close-btn:hover {
        background: #2a2a2a;
        color: #fff;
      }

      .chatbot-sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .chatbot-welcome-section {
        padding: 16px;
        background: #2a2a2a;
        border-radius: 12px;
        border: 1px solid #3a3a3a;
        margin-bottom: 8px;
      }

      .chatbot-welcome-message {
        color: #fff;
        font-size: 14px;
        line-height: 1.6;
      }

      .chatbot-messages {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }

      .chatbot-message {
        display: flex;
        margin-bottom: 8px;
      }

      .bot-message {
        justify-content: flex-start;
      }

      .user-message {
        justify-content: flex-end;
      }

      .message-content {
        max-width: 75%;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.6;
        word-wrap: break-word;
        word-break: break-word;
      }

      .message-content code {
        background: rgba(255, 255, 255, 0.1);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
      }

      .message-content strong {
        font-weight: 600;
      }

      .message-content em {
        font-style: italic;
      }

      .message-content ul {
        margin: 8px 0;
        padding-left: 20px;
        list-style-type: disc;
      }

      .message-content li {
        margin: 4px 0;
      }

      .bot-message .message-content {
        background: #2a2a2a;
        color: #fff;
        border-bottom-left-radius: 4px;
      }

      .user-message .message-content {
        background: var(--chatbot-primary);
        color: #fff;
        border-bottom-right-radius: 4px;
      }

      .chatbot-sidebar-footer {
        padding: 16px 20px;
        border-top: 1px solid #2a2a2a;
        background: #1a1a1a;
      }

      .chatbot-input-wrapper {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      #chatbot-input {
        flex: 1;
        padding: 12px 16px;
        border: 1px solid #2a2a2a;
        border-radius: 24px;
        outline: none;
        font-size: 14px;
        color: #fff;
        background-color: #2a2a2a;
        transition: all 0.2s;
      }

      #chatbot-input:focus {
        border-color: var(--chatbot-primary);
        background-color: #333;
      }

      #chatbot-input::placeholder {
        color: #666;
      }

      .chatbot-send-btn {
        width: 44px;
        height: 44px;
        background: var(--chatbot-primary);
        color: #fff;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .chatbot-send-btn:hover {
        background: var(--chatbot-primary-hover);
        transform: scale(1.05);
      }

      .chatbot-send-btn:disabled {
        background: #444;
        cursor: not-allowed;
        transform: none;
      }

      .chatbot-trigger-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        background: var(--chatbot-primary);
        color: #fff;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 9997;
        transition: all 0.3s;
      }

      .chatbot-trigger-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      .chatbot-trigger-btn.hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }

      .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 12px 16px;
        background: #2a2a2a;
        border-radius: 12px;
        max-width: 80px;
      }

      .typing-dot {
        width: 8px;
        height: 8px;
        background: #666;
        border-radius: 50%;
        animation: typing 1.4s infinite ease-in-out;
      }

      .typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .typing-dot:nth-child(2) { animation-delay: -0.16s; }

      @keyframes typing {
        0%, 80%, 100% {
          transform: scale(0);
        }
        40% {
          transform: scale(1);
        }
      }

      @media (max-width: 480px) {
        .chatbot-sidebar {
          width: 100vw;
          right: -100vw;
        }
      }

      /* Scrollbar styling */
      .chatbot-sidebar-content::-webkit-scrollbar {
        width: 6px;
      }

      .chatbot-sidebar-content::-webkit-scrollbar-track {
        background: #1a1a1a;
      }

      .chatbot-sidebar-content::-webkit-scrollbar-thumb {
        background: #444;
        border-radius: 3px;
      }

      .chatbot-sidebar-content::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    `;

    document.head.appendChild(styles);
    document.body.appendChild(widget);

    return widget;
  }

  // Format message content - convert markdown and newlines to HTML
  function formatMessage(content) {
    if (!content) return '';
    
    let formatted = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    const lines = formatted.split('\n');
    const processedLines = [];
    let inList = false;
    let listItems = [];
    
    function closeList() {
      if (listItems.length > 0) {
        processedLines.push('<ul>' + listItems.join('') + '</ul>');
        listItems = [];
      }
      inList = false;
    }
    
    lines.forEach((line) => {
      const listMatch = line.match(/^(\s*)([-*]\s+|(\d+)\.\s+)(.+)$/);
      
      if (listMatch) {
        if (!inList) {
          inList = true;
        }
        listItems.push('<li>' + listMatch[4] + '</li>');
      } else {
        if (inList) {
          closeList();
        }
        processedLines.push(line);
      }
    });
    
    closeList();
    formatted = processedLines.join('\n');
    
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    formatted = formatted.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  // Add message to chat
  function addMessage(content, isUser = false) {
    const messagesContainer = document.getElementById('chatbot-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chatbot-message ${isUser ? 'user-message' : 'bot-message'}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (isUser) {
      contentDiv.textContent = content;
    } else {
      contentDiv.innerHTML = formatMessage(content);
    }
    
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Show typing indicator
  function showTyping() {
    const messagesContainer = document.getElementById('chatbot-messages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chatbot-message bot-message';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Hide typing indicator
  function hideTyping() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }
  }

  // Send message to API
  async function sendMessage(message) {
    try {
      const response = await fetch(CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          botId: botId,
          message: message
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.reply;
    } catch (error) {
      console.error('Chatbot API error:', error);
      return 'Xin lỗi, tôi gặp lỗi khi xử lý. Vui lòng thử lại sau.';
    }
  }

  // Handle user input
  async function handleUserInput() {
    const input = document.getElementById('chatbot-input');
    const sendButton = document.getElementById('chatbot-send');
    const message = input.value.trim();

    if (!message || isLoading) return;

    addMessage(message, true);
    conversation.push({ role: 'user', content: message });
    saveConversation();

    analytics.messagesSent++;
    trackEvent('message_sent', { messageLength: message.length });

    input.value = '';
    sendButton.disabled = true;
    isLoading = true;

    showTyping();

    try {
      const reply = await sendMessage(message);
      hideTyping();
      addMessage(reply);
      conversation.push({ role: 'bot', content: reply });
      saveConversation();
    } catch (error) {
      hideTyping();
      addMessage('Xin lỗi, tôi gặp lỗi khi xử lý. Vui lòng thử lại sau.');
    } finally {
      isLoading = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  // Toggle chat sidebar
  function toggleChat() {
    const sidebar = document.getElementById('chatbot-sidebar');
    const overlay = document.getElementById('chatbot-overlay');
    const trigger = document.getElementById('chatbot-trigger');
    isOpen = !isOpen;
    
    if (isOpen) {
      sidebar.classList.add('open');
      overlay.classList.add('active');
      trigger.classList.add('hidden');
      document.body.style.overflow = 'hidden';
      document.getElementById('chatbot-input').focus();
      trackEvent('chat_opened');
    } else {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      trigger.classList.remove('hidden');
      document.body.style.overflow = '';
      trackEvent('chat_clened');
    }
  }

  // Load conversation history
  function loadChatHistory() {
    const messagesContainer = document.getElementById('chatbot-messages');
    messagesContainer.innerHTML = '';
    
    conversation.forEach(msg => {
      addMessage(msg.content, msg.role === 'user');
    });
  }

  // Initialize chatbot
  async function init() {
    loadConversation();
    await loadBotSettings();
    console.log('Bot settings after load:', botSettings);
    const widget = createWidget();
    
    trackEvent('widget_loaded');
    
    // Event listeners
    document.getElementById('chatbot-trigger').addEventListener('click', toggleChat);
    document.getElementById('chatbot-close').addEventListener('click', toggleChat);
    document.getElementById('chatbot-overlay').addEventListener('click', toggleChat);
    document.getElementById('chatbot-send').addEventListener('click', handleUserInput);
    
    document.getElementById('chatbot-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleUserInput();
      }
    });

    // Placeholder action buttons
    document.getElementById('chatbot-search').addEventListener('click', () => {
      console.log('Search clicked');
    });
    document.getElementById('chatbot-language').addEventListener('click', () => {
      console.log('Language clicked');
    });
    document.getElementById('chatbot-fullscreen').addEventListener('click', () => {
      console.log('Fullscreen clicked');
    });

    loadChatHistory();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

