const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    const hojaId = process.env.PRODUCTION_ORDERS_ID;
    if (!hojaId) {
      throw new Error('El ID de la hoja de Producción no está configurado.');
    }

    // Leemos hasta la columna O para asegurarnos de tomar la fecha.
    const rango = 'Hoja 1!A:O'; 

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
    if (!rows || rows.length <= 1) {
      return { statusCode: 200, body: JSON.stringify([]) };
    }

    // 1. FILTRAR Y TRANSFORMAR DATOS INICIALES
    const allResources = rows.slice(1)
      .filter(row => {
        const resource = row[0] || '';
        // **RESTRICCIÓN**: Omitimos recursos que empiezan con 'O' (Operadores)
        return resource && !resource.toUpperCase().startsWith('O');
      })
      .map(row => ({
        resource: row[0] || '',
        department: row[3] || '',
        assembly: row[4] || '',
        job: row[5] || '',
        requiredQty: parseFloat(row[8]) || 0, // 'Required Quantit' en columna I
        openQty: parseFloat(row[10]) || 0,   // 'Open Quantity' en columna K
        startDate: row[14] || null,        // 'Cs-Start Date' en columna O
      }));

    // 2. AGRUPAR RECURSOS POR 'JOB'
    const groupedJobs = allResources.reduce((acc, resource) => {
      const jobKey = resource.job;
      if (!jobKey) return acc;

      if (!acc[jobKey]) {
        acc[jobKey] = {
          job: resource.job,
          assembly: resource.assembly,
          department: resource.department,
          requiredQty: resource.requiredQty,
          startDate: resource.startDate,
          resources: []
        };
      }
      acc[jobKey].resources.push({
        name: resource.resource,
        openQty: resource.openQty
      });
      return acc;
    }, {});
    
    // 3. Convertir el objeto de jobs agrupados de nuevo a un array
    const data = Object.values(groupedJobs);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Error al leer la hoja de Google:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ details: 'Error interno del servidor al leer la hoja.' }),
    };
  }
};