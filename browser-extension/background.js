// Fnav Bookmark Manager - Background Service Worker

// Install event
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Fnav Bookmark Manager installed:', details.reason);
  
  if (details.reason === 'install') {
    // Set default values
    chrome.storage.sync.set({
      fnavConfig: {
        apiUrl: '',
        platform: 'edgeone',
        password: ''
      }
    });
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCurrentTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] || null });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'openTab') {
    chrome.tabs.create({ url: request.url });
    sendResponse({ success: true });
  }
  
  if (request.action === 'copyToClipboard') {
    navigator.clipboard.writeText(request.text).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});
