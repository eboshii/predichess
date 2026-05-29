# Predichess Web Client

A sleek, premium widescreen static web client companion for the **Predichess** Android application.

This web client is designed specifically for widescreen laptop and desktop layouts, offering an identical, synchronized gameplay experience alongside native Android players by interfacing with the same real-time Firebase Auth and Cloud Firestore backends.

## ⚔️ Cyber-Tactical Features
*   **Widescreen Grid Deck:** Left-hand board panel centered side-by-side with a detailed move action history, turn indicators, and player cards.
*   **Vector SVGs:** Inline vector SVG chess pieces styled in flat dark cyberpunk gradients, rendering perfectly on high-resolution laptop screens.
*   **Real-time Handshake:** Firestore subscriptions capture and propagate move completions, sprung traps, checks, and resignations instantly.
*   **Full Review Mode:** Timeline navigation buttons (`⏮`, `◀`, `▶`) and scroll-log item clicks freeze the live board to let players examine previous states, with a dedicated `LIVE` button to jump back into active sync.
*   **Pulsing Trap Springs:** Glowing grid borders and animated expanding shockwave rings illuminate vaporized piece cells.

## 📂 Project Structure
*   `index.html` — Document layouts, auth modals, tabs, grid containers, and logs.
*   `styles.css` — Custom stylesheet using CSS variables to implement the dark navy cyberpunk palette, outlined Material-style inputs, and CSS keyframe animations.
*   `chess.js` — Self-contained chess engine in ES6 that perfectly models the Kotlin game validation rules.
*   `app.js` — Web controller binding DOM handlers, coordinate conversions, drag-and-drop actions, and Firebase listeners.

## 🚀 Easy Hosting on GitHub Pages
This repository is 100% static and zero-dependency, meaning it can be hosted completely free on **GitHub Pages**:

1. Create a **public** repository named `predichess` on GitHub.
2. Push this folder to your repository:
   ```bash
   git init
   git add .
   git commit -m "feat: initial release of Predichess Web"
   git branch -M main
   git remote add origin https://github.com/your-username/predichess.git
   git push -u origin main
   ```
3. In your GitHub repository's **Settings** -> **Pages**, set **Source** to `Deploy from a branch` and choose the `main` branch, `/ (root)` folder.
4. Click **Save**. The website will be live in seconds at `https://your-username.github.io/predichess/`!
