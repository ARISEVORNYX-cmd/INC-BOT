// Arise's WhatsApp number in international format (India country code +91, digits only).
const WHATSAPP_NUMBER = '919336284717';
const DEFAULT_MESSAGE = 'Hi Arise, I would like to discuss management support. Please share your availability and payment details.';

const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-nav');

const closeNavigation = (restoreFocus = false) => {
  if (!menuToggle || !navigation) return;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  navigation.classList.remove('is-open');
  if (restoreFocus) menuToggle.focus();
};

if (menuToggle && navigation) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeNavigation();
      return;
    }
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close navigation');
    navigation.classList.add('is-open');
  });

  navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => closeNavigation());
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
      closeNavigation(true);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    if (isOpen && !menuToggle.contains(event.target) && !navigation.contains(event.target)) {
      closeNavigation();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeNavigation();
  });
}

const contactButton = document.querySelector('[data-whatsapp]');

if (contactButton) {
  contactButton.addEventListener('click', () => {
    const cleanNumber = WHATSAPP_NUMBER.replace(/\D/g, '');
    const url = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(DEFAULT_MESSAGE)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());
