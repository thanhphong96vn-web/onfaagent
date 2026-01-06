/**
 * Format message for Telegram with HTML styling
 * Converts markdown to Telegram HTML format and improves readability
 */

/**
 * Escape HTML special characters for Telegram HTML format
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramMessage(text: string): string {
  if (!text) return '';

  let formatted = text;

  // Normalize line breaks
  formatted = formatted.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Normalize multiple consecutive newlines
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  formatted = formatted.replace(/\n{2}/g, '\n');

  // Split into lines for processing
  const lines = formatted.split('\n');
  const processedLines: string[] = [];
  
  lines.forEach((line) => {
    // Check for numbered list items (1. 2. 3.)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    
    if (numberedMatch) {
      // Format as bold number + content
      const num = numberedMatch[1];
      const content = numberedMatch[2];
      processedLines.push(`<b>${num}.</b> ${escapeHtml(content)}`);
    } else {
      // Check for bullet points (- or •)
      const bulletMatch = line.match(/^[-•]\s+(.+)$/);
      
      if (bulletMatch) {
        // Format with bullet emoji
        processedLines.push(`• ${escapeHtml(bulletMatch[1])}`);
      } else {
        // Regular line - process markdown formatting
        let processedLine = line;
        
        // Convert markdown bold **text** to HTML <b>text</b>
        processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, (match, content) => {
          return `<b>${escapeHtml(content)}</b>`;
        });
        
        // Convert markdown italic *text* to HTML <i>text</i> (but not if it's part of **)
        processedLine = processedLine.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, (match, content) => {
          return `<i>${escapeHtml(content)}</i>`;
        });
        
        // Convert markdown code `code` to HTML <code>code</code>
        processedLine = processedLine.replace(/`([^`]+)`/g, (match, content) => {
          return `<code>${escapeHtml(content)}</code>`;
        });
        
        // Convert markdown underline __text__ to HTML <u>text</u>
        processedLine = processedLine.replace(/__(.*?)__/g, (match, content) => {
          return `<u>${escapeHtml(content)}</u>`;
        });
        
        // Escape any remaining HTML characters that weren't converted
        // But preserve our HTML tags
        processedLine = processedLine.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, '&amp;');
        processedLine = processedLine.replace(/<(?![biu]|code|pre|a\s|/)/g, '&lt;');
        processedLine = processedLine.replace(/(?<!<\/[biu]|<\/code|<\/pre|<\/a)>/g, '&gt;');
        
        processedLines.push(processedLine);
      }
    }
  });

  formatted = processedLines.join('\n');

  // Add spacing after headings (lines ending with :)
  formatted = formatted.replace(/^(.+):\n/gm, '$1:\n\n');

  // Clean up multiple spaces
  formatted = formatted.replace(/[ \t]{2,}/g, ' ');

  // Trim leading/trailing whitespace
  formatted = formatted.trim();

  return formatted;
}

