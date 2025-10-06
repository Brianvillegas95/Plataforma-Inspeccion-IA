const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    const hojaId = process.env.PRODUCTION_ORDERS_ID;
    if (!hojaId) throw new Error('El ID de la hoja de Producción no está configurado.');
    
    const rango = 'Hoja 1!A:X';

    // === CORRECCIÓN CLAVE AQUÍ ===
    // Restauramos las credenciales para que se lean desde las variables de Netlify.
    const credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: hojaId, range: rango });
    const rows = response.data.values;

    if (!rows || rows.length <= 1) return { statusCode: 200, body: JSON.stringify([]) };

    const resources = rows.slice(1)
      .filter(row => row[0] && !row[0].toUpperCase().startsWith('O'))
      .map(row => {
        let requiredHours = parseFloat(row[9]) || 0;
        let openHours = parseFloat(row[11]) || 0;
        const basis = row[5] || '';
        const usageRate = parseFloat(row[6]) || 0;

        let finalRequired = requiredHours;
        let finalOpen = openHours;

        if (basis.toLowerCase() === 'item' && usageRate > 0) {
          finalRequired = requiredHours / usageRate;
          finalOpen = openHours / usageRate;
        }
        
        const progress = finalRequired > 0 ? (1 - (finalOpen / finalRequired)) * 100 : 0;
        const appliedQty = finalRequired - finalOpen;

        return {
          resourceName: row[0],
          department: row[3],
          requiredQty: finalRequired,
          appliedQty: appliedQty,
          openQty: finalOpen,
          progress: progress.toFixed(1),
          startDate: row[14],
          completionDate: row[15],
          job: row[18],
          assembly: row[20],
        };
      });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resources),
    };

  } catch (error) {
    // Este log te ayudará a ver errores detallados en la consola de Netlify en el futuro.
    console.error('Error detallado en la función Netlify:', error);
    return { statusCode: 500, body: JSON.stringify({ details: 'Error interno del servidor.' }) };
  }
};