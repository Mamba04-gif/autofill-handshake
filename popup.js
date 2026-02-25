// Handshake Autofill — Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  const taskTypeInput = document.getElementById('taskType');
  const qualityScore = document.getElementById('qualityScore');
  const excellent = document.getElementById('excellent');
  const good = document.getElementById('good');
  const fair = document.getElementById('fair');
  const bad = document.getElementById('bad');
  const autoAdvance = document.getElementById('autoAdvance');
  const saveBtn = document.getElementById('saveBtn');
  const autofillBtn = document.getElementById('autofillBtn');
  const status = document.getElementById('status');
  const profileSelectContainer = document.getElementById('profileSelectContainer');
  const profileSelectTrigger = document.getElementById('profileSelectTrigger');
  const profileOptions = document.getElementById('profileOptions');
  const profileSelectInput = document.getElementById('profileSelect');

  // ---- Load saved defaults ----
  function loadProfile(profileId) {
    chrome.storage.local.get([
      `taskType_${profileId}`, 'qualityScore', 'excellent', 'good', 'fair', 'bad', 'autoAdvance'
    ], (data) => {
      // Clear task input first
      taskTypeInput.value = data[`taskType_${profileId}`] || '';

      // Global settings
      qualityScore.value = data.qualityScore !== undefined ? data.qualityScore : '0';
      excellent.value = data.excellent !== undefined ? data.excellent : '0';
      good.value = data.good !== undefined ? data.good : '0';
      fair.value = data.fair !== undefined ? data.fair : '0';
      bad.value = data.bad !== undefined ? data.bad : '0';
      autoAdvance.checked = data.autoAdvance !== undefined ? data.autoAdvance : true;
    });
  }

  // Initial load
  chrome.storage.local.get(['activeProfile'], (data) => {
    if (data.activeProfile) {
      activeProfile = data.activeProfile;
      updateCustomSelectUI(activeProfile);
    }
    loadProfile(activeProfile);
  });

  // ---- Custom Profile Dropdown Logic ----
  if (profileSelectContainer && profileSelectTrigger && profileOptions) {
    // Toggle dropdown open/close
    profileSelectTrigger.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent document click from firing
      profileSelectContainer.classList.toggle('open');
    });

    // Handle option click
    const options = profileOptions.querySelectorAll('.custom-option');
    options.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = option.dataset.value;
        activeProfile = value;
        chrome.storage.local.set({ activeProfile });
        updateCustomSelectUI(value);
        profileSelectContainer.classList.remove('open');
        loadProfile(activeProfile);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!profileSelectContainer.contains(e.target)) {
        profileSelectContainer.classList.remove('open');
      }
    });
  }

  function updateCustomSelectUI(value) {
    if (!profileSelectInput || !profileSelectTrigger || !profileOptions) return;
    profileSelectInput.value = value;

    // Update trigger text
    const textSpan = profileSelectTrigger.querySelector('span');
    if (textSpan) textSpan.textContent = `Profile ${value}`;

    // Update selected class
    const options = profileOptions.querySelectorAll('.custom-option');
    options.forEach(opt => {
      if (opt.dataset.value === value) {
        opt.classList.add('selected');
      } else {
        opt.classList.remove('selected');
      }
    });
  }



  // ---- Save Defaults ----
  saveBtn.addEventListener('click', () => {
    // Refresh the activeProfile from the input in case it wasn't tracked
    if (profileSelectInput) {
      activeProfile = profileSelectInput.value;
    }

    const dataToSave = {};
    dataToSave[`taskType_${activeProfile}`] = taskTypeInput.value;
    dataToSave.qualityScore = qualityScore.value;
    dataToSave.excellent = excellent.value;
    dataToSave.good = good.value;
    dataToSave.fair = fair.value;
    dataToSave.bad = bad.value;
    dataToSave.autoAdvance = autoAdvance.checked;

    chrome.storage.local.set(dataToSave, () => {
      showStatus(`Profile ${activeProfile} saved!`, 'success');
    });
  });

  // ---- Autofill ----
  autofillBtn.addEventListener('click', async () => {
    if (!taskTypeInput.value) {
      showStatus('Please select a task type first.', 'warning');
      return;
    }

    const config = {
      taskType: taskTypeInput.value,
      otherLabel: 'X', // Hardcoded as the Other input is removed
      qualityScore: qualityScore.value || '0',
      excellent: excellent.value || '0',
      good: good.value || '0',
      fair: fair.value || '0',
      bad: bad.value || '0',
      autoAdvance: autoAdvance.checked
    };

    // Remove processing status and animation
    // autofillBtn.classList.add('running');
    // autofillBtn.textContent = 'Filling…';
    // showStatus('Sending autofill request…', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url) {
        showStatus('Could not access current tab.', 'error');
        resetAutofillBtn();
        return;
      }

      const isHandshake = tab.url.includes('joinhandshake.com');
      const isLocal = tab.url.startsWith('file://');

      if (!isHandshake && !isLocal) {
        showStatus('Navigate to a Handshake AI task page first.', 'error');
        resetAutofillBtn();
        return;
      }

      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, {
          action: 'autofill',
          config
        });
      } catch (err) {
        // If content script is not loaded, try injecting it dynamically
        if (err.message && err.message.includes('Receiving end does not exist')) {
          console.log('Content script not found, injecting...');
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          // Small delay to ensure listener is fully registered
          await new Promise(r => setTimeout(r, 100));
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'autofill',
            config
          });
        } else {
          throw err;
        }
      }

      if (response && response.success) {
        showStatus(response.message || 'Autofill complete!', 'success');
      } else {
        showStatus(response?.message || 'Autofill failed — check the page.', 'error');
      }
    } catch (err) {
      console.error('Autofill error:', err);
      showStatus('Could not reach the page or content script. Please reload the page.', 'error');
    } finally {
      resetAutofillBtn();
    }
  });

  function resetAutofillBtn() {
    autofillBtn.classList.remove('running');
    // Replaced because textContent is not changed anymore
    // autofillBtn.innerHTML = `...`
  }

  // ---- Status helper ----
  function showStatus(msg, type) {
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    status.className = `status ${type}`;
    status.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(msg)}`;
    status.style.display = 'flex';

    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        status.style.display = 'none';
      }, 4000);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
