# Arise — Personal & Project Management

A standalone, responsive, English-language landing page for Arise, a professional manager based in India. It presents personal, project, operations, and event coordination support, and is intentionally separate from Ari's existing app and the SellPilot dashboard.

## Preview

From this directory, run:

```sh
python3 -m http.server 4175 --bind 0.0.0.0
```

Then open `http://localhost:4175` locally. In Arena, the preview process can expose it in the browser.

## Before publishing

1. The page is branded as Arise, identifies the location as India, and is written in English.
2. The WhatsApp CTA is configured for the number supplied by the owner; payment details are directed to a private message rather than published.
3. Review the service descriptions and contact information before publishing.
4. Deploy this directory as a separate static site. It is not wired into Ari's root app and has not been deployed.

## Notes

- No npm packages, external APIs, analytics, or form backend are used.
- Google Fonts are an optional visual enhancement; system font fallbacks are provided.
- The contact CTA opens WhatsApp with a prefilled enquiry. No enquiries are collected or stored by this site.

## Reverse-engineered behavior

- `index.html` contains the single-page content and native `<details>` FAQ controls.
- `style.css` owns the layout and responsive breakpoints (1020px, 760px, and 390px), with reduced-motion and visible keyboard-focus styles.
- `script.js` controls the mobile menu (toggle, Escape, outside click, navigation link, and desktop-resize close), the WhatsApp click-to-chat URL, and the copyright year.
- Navigation and service calls-to-action are in-page anchor links. There is no login, payment gateway, booking backend, or data collection; payment details are discussed privately by WhatsApp.

## QA notes

- Checked both buttons, menu close/open paths, all in-page link targets, FAQ disclosure, and the generated WhatsApp number/message with simulated DOM clicks.
- The WhatsApp URL is verified but deliberately not opened or sent during QA. The external WhatsApp service and visual rendering in a real browser still require live-browser verification.
