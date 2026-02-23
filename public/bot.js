(function () {
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
    // Use custom API URL if provided
    CONFIG.apiUrl = apiUrl;
  } else {
    // Auto-detect: use the same origin as the script file
    const scriptSrc = scriptTag ? scriptTag.src : '';
    if (scriptSrc) {
      const scriptUrl = new URL(scriptSrc);
      CONFIG.apiUrl = scriptUrl.origin + '/api/public/chat';
    } else {
      // Fallback to current origin (for backward compatibility)
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
  let currentTheme = 'dark';
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

    // Send analytics to server (optional)
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
      }).then(response => {
        if (response.ok) {
          console.log('Analytics sent successfully');
        } else {
          console.warn('Analytics failed to send');
        }
      }).catch(error => {
        console.warn('Analytics error:', error);
      });
    }
  }

  // Create chat widget HTML
  function createWidget() {
    const themeColor = botSettings?.themeColor || '#3B82F6';
    const botName = botSettings?.name || 'AI Assistant';
    const welcomeMessage = botSettings?.welcomeMessage;

    // Get the base path for images (same directory structure as script)
    let imageBasePath = '';
    if (scriptTag && scriptTag.src) {
      const scriptUrl = new URL(scriptTag.src);
      imageBasePath = scriptUrl.origin + scriptUrl.pathname.replace(/\/[^/]*$/, '/images/DRACO_FlyingIdle.gif');
    } else {
      // Fallback to relative path
      imageBasePath = './images/DRACO_FlyingIdle.gif';
    }

    console.log('Creating widget with:', { themeColor, botName, welcomeMessage, botSettings });

    const widget = document.createElement('div');
    widget.id = 'chatbot-widget';
    widget.innerHTML = `
      <div class="chatbot-container">
        <div class="chatbot-button" id="chatbot-toggle">
          <img src="${imageBasePath}" alt="Chat" style="width: 100%; height: 100%; object-fit: contain;" id="chatbot-icon-img" />
        </div>
        <div class="chatbot-modal" id="chatbot-modal" data-theme="dark">
          <div class="chatbot-header">
            <div class="chatbot-title">${botName}</div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button class="chatbot-theme-toggle" id="chatbot-theme-toggle" title="Toggle dark/light mode">
                <svg class="sun-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                <svg class="moon-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
              </button>
              <button class="chatbot-close" id="chatbot-close">×</button>
            </div>
          </div>
          <div class="chatbot-messages" id="chatbot-messages">
            <!-- Welcome message will be loaded dynamically -->
          </div>
          <div class="chatbot-input-container">
            <input type="text" id="chatbot-input" placeholder="Type your message..." />
            <button id="chatbot-send">Send</button>
          </div>
        </div>
      </div>
    `;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      #chatbot-widget {
        --chatbot-primary: ${themeColor};
        --chatbot-primary-hover: ${adjustColor(themeColor, -20)};
        --chatbot-primary-light: ${adjustColor(themeColor, 40)};
        
        /* Theme variables */
        --chatbot-bg: rgba(255, 255, 255, 0.95);
        --chatbot-text: #374151;
        --chatbot-bot-msg-bg: #f3f4f6;
        --chatbot-bot-msg-text: #374151;
        --chatbot-input-bg: #ffffff;
        --chatbot-input-text: #374151;
        --chatbot-border: #e5e7eb;
        
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .chatbot-modal[data-theme="dark"] {
        --chatbot-bg: rgba(10, 10, 10, 0.96);
        --chatbot-text: #f3f4f6;
        --chatbot-bot-msg-bg: #1e1f22;
        --chatbot-bot-msg-text: #f3f4f6;
        --chatbot-input-bg: #18191c;
        --chatbot-input-text: #ffffff;
        --chatbot-border: #2b2d31;
      }

      .chatbot-modal[data-theme="dark"] .chatbot-messages {
        scrollbar-color: #374151 transparent;
      }

      .chatbot-modal[data-theme="dark"] .chatbot-messages::-webkit-scrollbar {
        width: 10px;
      }

      .chatbot-modal[data-theme="dark"] .chatbot-messages::-webkit-scrollbar-track {
        background: transparent;
      }

      .chatbot-modal[data-theme="dark"] .chatbot-messages::-webkit-scrollbar-thumb {
        background: #374151;
        border-radius: 10px;
      }

      .chatbot-modal[data-theme="dark"] .chatbot-messages::-webkit-scrollbar-thumb:hover {
        background: #4b5563;
      }

      .chatbot-container {
        position: relative;
      }

      .chatbot-button {
        width: 150px;
        height: 150px;
        background: transparent;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        color: white;
        position: relative;
        overflow: hidden;
        padding: 0;
        border: none;
      }

      .chatbot-button.hidden {
        opacity: 0;
        pointer-events: none;
        transform: scale(0);
      }

      .chatbot-button:hover {
        transform: scale(1.05);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
      }

      @media (max-width: 768px) {
        .chatbot-button {
          width: 120px;
          height: 120px;
        }
      }

      @media (max-width: 480px) {
        .chatbot-button {
          width: 100px;
          height: 100px;
        }
      }

      .chatbot-button:active {
        transform: scale(0.95);
      }

      .chatbot-modal {
        position: absolute;
        bottom: 170px;
        right: 0;
        width: 380px;
        height: 520px;
        background: var(--chatbot-bg);
        backdrop-filter: blur(20px);
        border-radius: 20px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        display: none;
        flex-direction: column;
        overflow: hidden;
        transition: bottom 0.3s ease-out, background 0.3s ease;
        color: var(--chatbot-text);
      }

      @media (max-width: 768px) {
        .chatbot-modal {
          bottom: 140px;
        }
      }

      @media (max-width: 480px) {
        .chatbot-modal {
          bottom: 120px;
        }
      }

      .chatbot-modal.open {
        display: flex;
        animation: slideUp 0.3s ease-out;
        bottom: 20px;
      }

      @media (max-width: 768px) {
        .chatbot-modal.open {
          bottom: 10px;
        }
      }

      @media (max-width: 480px) {
        .chatbot-modal.open {
          bottom: 10px;
        }
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .chatbot-header {
        background: linear-gradient(135deg, var(--chatbot-primary), var(--chatbot-primary-hover));
        color: white;
        padding: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        overflow: hidden;
      }

      .chatbot-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
        animation: shimmer 3s infinite;
      }

      @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }

      .chatbot-title {
        font-weight: 600;
        font-size: 16px;
      }

      .chatbot-close, .chatbot-theme-toggle {
        background: none;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: background-color 0.2s;
        opacity: 0.9;
      }

      .chatbot-close:hover, .chatbot-theme-toggle:hover {
        background-color: rgba(255, 255, 255, 0.1);
        opacity: 1;
      }

      .chatbot-theme-toggle svg {
        transition: transform 0.3s ease;
      }

      .chatbot-theme-toggle:active svg {
        transform: rotate(45deg);
      }

      .chatbot-messages {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
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

      #chatbot-widget .message-content {
        max-width: 80%;
        padding: 12px 16px !important;
        border-radius: 18px !important;
        font-size: 14px;
        line-height: 1.6;
        word-wrap: break-word;
        word-break: break-word;
      }
      
      .message-content code {
        background: rgba(0, 0, 0, 0.1);
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
      
      .message-content br {
        line-height: 1.6;
      }

      #chatbot-widget .bot-message .message-content {
        background: var(--chatbot-bot-msg-bg) !important;
        color: var(--chatbot-bot-msg-text) !important;
        border-bottom-left-radius: 4px;
      }

      #chatbot-widget .user-message .message-content {
        background: var(--chatbot-primary) !important;
        color: white !important;
        border-bottom-right-radius: 4px;
      }

      .chatbot-input-container {
        padding: 16px;
        border-top: 1px solid var(--chatbot-border);
        display: flex;
        gap: 8px;
        background: var(--chatbot-bg);
      }

      #chatbot-input {
        flex: 1;
        padding: 12px 16px;
        border: none;
        border-radius: 24px;
        outline: none;
        font-size: 14px;
        color: var(--chatbot-input-text);
        background-color: var(--chatbot-input-bg);
        box-shadow: 0 0 0 1px var(--chatbot-border);
        transition: all 0.2s ease;
      }

      #chatbot-input:focus {
        box-shadow: 0 0 0 1.5px var(--chatbot-primary-hover);
      }

      #chatbot-send {
        padding: 12px 20px;
        background: var(--chatbot-primary);
        color: white;
        border: none;
        border-radius: 24px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s;
      }

      #chatbot-send:hover {
        background: var(--chatbot-primary-hover);
      }

      #chatbot-send:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }

      .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 12px 16px;
        background: var(--chatbot-bot-msg-bg);
        border-radius: 18px;
        max-width: 80px;
      }

      .typing-dot {
        width: 8px;
        height: 8px;
        background: #9ca3af;
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
        .chatbot-modal {
          width: calc(100vw - 40px);
          height: calc(100vh - 100px);
          bottom: 10px;
          right: 10px;
        }
      }
    `;

    document.head.appendChild(styles);
    document.body.appendChild(widget);

    // Set up fallback to SVG icon if GIF fails to load
    const iconImg = document.getElementById('chatbot-icon-img');
    const chatbotButton = document.getElementById('chatbot-toggle');
    const chatbotModal = document.getElementById('chatbot-modal');

    if (iconImg) {
      iconImg.addEventListener('error', function () {
        // Replace image with SVG icon
        chatbotButton.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
        // Reset button size to original 60px
        chatbotButton.style.width = '60px';
        chatbotButton.style.height = '60px';
        chatbotButton.style.background = 'linear-gradient(135deg, var(--chatbot-primary), var(--chatbot-primary-hover))';
        // Adjust modal position back to original
        if (chatbotModal) {
          chatbotModal.style.bottom = '80px';
        }
        // Remove responsive classes that might interfere
        chatbotButton.classList.remove('hidden');
      });
    }

    return widget;
  }

  // Format message content - convert markdown and newlines to HTML
  function formatMessage(content) {
    if (!content) return '';

    // Escape HTML to prevent XSS first
    let formatted = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Normalize multiple consecutive newlines (3+ newlines become 2, 2+ newlines become 1)
    // This prevents excessive spacing while preserving intentional paragraph breaks
    formatted = formatted.replace(/\n{3,}/g, '\n\n'); // 3+ newlines -> 2 newlines
    formatted = formatted.replace(/\n{2}/g, '\n'); // 2 newlines -> 1 newline

    // Process lists first (before converting newlines)
    // Split into lines to process lists
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

    lines.forEach((line, index) => {
      // Check for list items: - or * or number.
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
        // Skip empty lines to reduce spacing
        if (line.trim() !== '' || index === 0 || index === lines.length - 1) {
          processedLines.push(line);
        }
      }
    });

    // Close any remaining list
    closeList();

    formatted = processedLines.join('\n');

    // Convert markdown-style formatting
    // Bold: **text** or __text__
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // Italic: *text* (but not if it's part of **)
    formatted = formatted.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    formatted = formatted.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');

    // Code: `code`
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert single newlines to <br>, but avoid consecutive <br><br>
    formatted = formatted.replace(/\n/g, '<br>');

    // Remove consecutive <br> tags (more than 2 consecutive becomes just 2)
    formatted = formatted.replace(/(<br>\s*){3,}/gi, '<br><br>');

    return formatted;
  }

  // Add message to chat
  function addMessage(content, isUser = false) {
    const messagesContainer = document.getElementById('chatbot-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chatbot-message ${isUser ? 'user-message' : 'bot-message'}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Format message content for bot messages, plain text for user messages
    if (isUser) {
      contentDiv.textContent = content;
    } else {
      contentDiv.innerHTML = formatMessage(content);
    }

    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    // Scroll to bottom
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
      console.log('Sending message to API:', { botId, message, apiUrl: CONFIG.apiUrl });

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

      console.log('API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('API response data:', data);
      return data.reply;
    } catch (error) {
      console.error('Chatbot API error:', error);
      return 'Sorry, I encountered an error. Please try again later.';
    }
  }

  // Handle user input
  async function handleUserInput() {
    const input = document.getElementById('chatbot-input');
    const sendButton = document.getElementById('chatbot-send');
    const message = input.value.trim();

    if (!message || isLoading) return;

    // Add user message
    addMessage(message, true);
    conversation.push({ role: 'user', content: message });
    saveConversation();

    // Track message sent
    analytics.messagesSent++;
    trackEvent('message_sent', { messageLength: message.length });

    // Clear input and disable send button
    input.value = '';
    sendButton.disabled = true;
    isLoading = true;

    // Show typing indicator
    showTyping();

    try {
      // Send to API
      const reply = await sendMessage(message);

      // Hide typing indicator
      hideTyping();

      // Add bot response
      addMessage(reply);
      conversation.push({ role: 'bot', content: reply });
      saveConversation();
    } catch (error) {
      hideTyping();
      addMessage('Sorry, I encountered an error. Please try again later.');
    } finally {
      isLoading = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  // Toggle chat modal
  function toggleChat() {
    const modal = document.getElementById('chatbot-modal');
    const button = document.getElementById('chatbot-toggle');
    isOpen = !isOpen;

    if (isOpen) {
      modal.classList.add('open');
      if (button) button.classList.add('hidden');
      document.getElementById('chatbot-input').focus();
      trackEvent('chat_opened');
    } else {
      modal.classList.remove('open');
      if (button) button.classList.remove('hidden');
      trackEvent('chat_closed');
    }
  }

  // Set theme
  function setTheme(theme) {
    const modal = document.getElementById('chatbot-modal');
    const toggleBtn = document.getElementById('chatbot-theme-toggle');
    if (!modal) return;

    currentTheme = theme;
    modal.setAttribute('data-theme', theme);
    localStorage.setItem('chatbot_theme_' + botId, theme);

    if (toggleBtn) {
      const sunIcon = toggleBtn.querySelector('.sun-icon');
      const moonIcon = toggleBtn.querySelector('.moon-icon');
      if (theme === 'dark') {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      }
    }
  }

  // Update dynamic primary color
  function updatePrimaryColor(color) {
    const widget = document.getElementById('chatbot-widget');
    if (widget) {
      widget.style.setProperty('--chatbot-primary', color);
      widget.style.setProperty('--chatbot-primary-hover', adjustColor(color, -20));
      widget.style.setProperty('--chatbot-primary-light', adjustColor(color, 40));
    }
  }

  // Toggle theme
  function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    trackEvent('theme_toggled', { theme: newTheme });
  }

  // Load conversation history
  function loadChatHistory() {
    const messagesContainer = document.getElementById('chatbot-messages');
    const welcomeMsg = botSettings?.welcomeMessage || 'Hello! How can I help you today?';
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'chatbot-message bot-message';
    const welcomeContent = document.createElement('div');
    welcomeContent.className = 'message-content';
    welcomeContent.innerHTML = formatMessage(welcomeMsg);
    welcomeDiv.appendChild(welcomeContent);
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(welcomeDiv);

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

    // Track widget initialization
    trackEvent('widget_loaded');

    // Event listeners
    document.getElementById('chatbot-toggle').addEventListener('click', toggleChat);
    document.getElementById('chatbot-close').addEventListener('click', toggleChat);
    document.getElementById('chatbot-theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('chatbot-send').addEventListener('click', handleUserInput);

    document.getElementById('chatbot-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleUserInput();
      }
    });

    // Load saved theme or default to dark
    const savedTheme = localStorage.getItem('chatbot_theme_' + botId) || 'dark';
    setTheme(savedTheme);

    // Load chat history
    loadChatHistory();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
