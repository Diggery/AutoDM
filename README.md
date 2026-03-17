# AutoDM

AutoDM is a React-based web application that integrates with Firebase and the Google Gemini API to bring intelligent, customizable AI chatbot capabilities.

## Features
- **AI-Powered Chat**: Communicate with an AI powered by Google's latest Gemini models.
- **Model Selection**: Switch between different Gemini models (e.g., Gemini Flash, Gemini Pro, Preview).
- **Bring Your Own Key (BYOK)**: Securely provide your own Google Gemini API key via the in-app Settings menu.
- **Serverless Backend**: Relies on Firebase for authentication, real-time Firestore databases, and fast hosting.

## Requirements
- Node.js installed locally
- A [Google Gemini API Key](https://aistudio.google.com/app/apikey)
- A Firebase project for your database and hosting configuration

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone <repository_url>
   cd AutoDM
   ```

2. **Install the dependencies:**
   ```bash
   npm install
   ```

3. **Configure Firebase:**
   Ensure you have configured your Firebase project settings correctly inside `src/firebase.js`.

4. **Start the development server:**
   ```bash
   npm run dev
   ```

## Deployment
AutoDM is fully configured for deployment to Firebase Hosting. 

To deploy a new version:
1. Build the production application:
   ```bash
   npm run build
   ```
2. Deploy using the Firebase CLI:
   ```bash
   npx firebase-tools deploy --only hosting
   ```

## Tech Stack
- **Frontend**: React, Vite, Vanilla CSS
- **Backend/Infrastructure**: Firebase (Auth, Firestore, Hosting)
- **AI Services**: `@google/genai` SDK
