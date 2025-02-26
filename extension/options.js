document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.sync.set({
    assemblyaiApiKey: apiKey
  }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Configurações salvas.';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });
});

// Carrega as configurações salvas
chrome.storage.sync.get(['assemblyaiApiKey'], (result) => {
  if (result.assemblyaiApiKey) {
    document.getElementById('apiKey').value = result.assemblyaiApiKey;
  }
}); 