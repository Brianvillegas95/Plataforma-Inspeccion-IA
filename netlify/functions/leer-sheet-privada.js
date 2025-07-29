const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    // 1. Obtiene el ID de la hoja desde la variable de entorno de Netlify
    const hojaId = process.env.PRODUCT_MASTER_SHEET_ID;
    if (!hojaId) {
      throw new Error('El ID de la hoja Maestra de Productos no está configurado en Netlify.');
    }

    // El rango que queremos leer. Asume que los datos están en 'Hoja 1' y ocupan las columnas A hasta D.
    const rango = 'Hoja 1!A:D'; 

    // 2. Autenticación (esto no cambia, usa las mismas credenciales de servicio)
    const credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 3. Llama a la API de Google Sheets usando el ID de hoja de la variable de entorno
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: hojaId,
      range: rango,
    });
    
    // 4. Procesa y devuelve los datos (omitiendo la fila de encabezados)
    const rows = response.data.values;
    const dataWithoutHeaders = rows && rows.length > 1 ? rows.slice(1) : [];
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataWithoutHeaders),
    };

  } catch (error) {
    console.error('Error al leer la hoja de Google:', error);
    return {
      statusCode: 500,
      body: 'Error interno del servidor al leer la hoja de cálculo.',
    };
  }
};