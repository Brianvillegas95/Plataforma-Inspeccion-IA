const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    const hojaId = process.env.PRODUCTION_ORDERS_ID;
    if (!hojaId) throw new Error('El ID de la hoja de Producción no está configurado.');
    
    const rango = 'Hoja 1!A:X';

    // ... Autenticación (sin cambios)
    const credentials = { /* ... */ };
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: hojaId, range: rango });
    const rows = response.data.values;

    if (!rows || rows.length <= 1) return { statusCode: 200, body: JSON.stringify([]) };

    // **LÓGICA SIMPLIFICADA: Un objeto por cada recurso activo**
    const resources = rows.slice(1)
      .filter(row => row[0] && !row[0].toUpperCase().startsWith('O')) // Filtrar operadores
      .map(row => {
        // Leemos los valores base en horas
        let requiredHours = parseFloat(row[9]) || 0;
        let openHours = parseFloat(row[11]) || 0;
        const basis = row[5] || '';
        const usageRate = parseFloat(row[6]) || 0;

        let finalRequired = requiredHours;
        let finalOpen = openHours;

        // Conversión a piezas si es necesario
        if (basis.toLowerCase() === 'item' && usageRate > 0) {
          finalRequired = requiredHours / usageRate;
          finalOpen = openHours / usageRate;
        }
        
        // Cálculo de progreso para este recurso específico
        const progress = finalRequired > 0 ? (1 - (finalOpen / finalRequired)) * 100 : 0;
        const appliedQty = finalRequired - finalOpen;

        // Devolvemos un objeto por cada recurso con toda la info del job
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
      body: JSON.stringify(resources), // Devolvemos la lista plana de recursos
    };

  } catch (error) {
    console.error('Error al leer la hoja de Google:', error);
    return { statusCode: 500, body: JSON.stringify({ details: 'Error interno del servidor.' }) };
  }
};