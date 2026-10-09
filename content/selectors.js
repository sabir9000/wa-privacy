// Every WhatsApp Web DOM hook the extension relies on lives here.
// WhatsApp ships minified, frequently changing class names, so these prefer
// ids, roles and attributes. When blurring stops working after a WhatsApp
// update, this is the file to fix.
globalThis.WAP_SEL = {
  // Left column: chat list (incl. search results), and the Archived list, which
  // opens in a separate drawer outside #pane-side.
  chatList: '#pane-side, [data-testid="archived-chatlist"]',
  chatRow: '[role="listitem"], [role="row"]',
  // First match inside a row is the chat name (its title attr holds the full name).
  rowName: 'span[title], span[dir="auto"]',
  // Text spans in a row; everything except the name is treated as the preview line.
  rowText: 'span[title], span[dir]',
  // Every picture in a row/header. Avatars with a status ring are drawn as an
  // SVG <image> inside the ring, so plain <img> alone misses them. Emoji are
  // <img> too and are excluded.
  avatar: 'img:not(.emoji):not([data-plain-text]), svg:has(image)',

  // Right column: the open conversation.
  conversation: '#main',
  header: 'header',
  headerName: 'span[title], span[dir="auto"]',
  headerText: 'span[title], span[dir]',
  // Every message row carries data-id (the message id); the classes are fallbacks.
  message: '[data-id], .message-in, .message-out',
  messageMedia: 'img:not(.emoji):not([data-plain-text]), video, canvas, svg:has(image)',
};
