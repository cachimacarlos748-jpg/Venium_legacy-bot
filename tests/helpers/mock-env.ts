// Must be imported before any app module: pins providers to mock mode so the
// test suite never touches live Venium/Pabilo APIs, regardless of the .env.
process.env.VENIUM_MODE = "mock";
process.env.PABILO_MODE = "mock";
process.env.GEMINI_MODE = "disabled";
process.env.WHATSAPP_MODE = "disabled";
process.env.ALLOW_LIVE_ORDER_CREATION = "false";
