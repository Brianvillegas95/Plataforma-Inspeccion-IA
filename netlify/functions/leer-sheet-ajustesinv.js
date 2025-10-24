const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    const hojaId = process.env.PRODUCT_AJUSTESINVENTARIO_SHEET_ID;
    
    // --- CORRECCIÓN ---
    // Se cambió 'hoId' por 'hojaId' para que coincida con la variable
    if (!hojaId) {
      throw new Error('El ID de la hoja de cálculo no está configurado en Netlify.');
    }

    // Se ajusta el rango para leer de la A a la I
    const rango = 'Hoja 1!A:I'; 

    const credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: hojaId,
      range: rango,
    });
    
    const rows = response.data.values;
    // Omitimos la fila de encabezados
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
      // Este es el error que tu navegador intentaba leer como JSON
      body: 'Error interno del servidor al leer la hoja de cálculo.', 
    };
  }
};