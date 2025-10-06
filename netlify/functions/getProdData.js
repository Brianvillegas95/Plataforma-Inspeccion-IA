// Archivo: netlify/functions/getProdData.js
// No se necesita 'require' ni 'import'. 'fetch' ya existe en el entorno.

exports.handler = async (event) => {
    
    // 1. Leemos el ID de la hoja desde las variables de Netlify.
    const SHEET_ID = process.env.PRODUCTION_ORDERS_ID;
    
    // 2. Construimos la URL de descarga directa de CSV.
    //    Esto tomará automáticamente la primera hoja visible del archivo.
    const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

    try {
        if (!SHEET_ID) {
            throw new Error("El ID de la hoja (PRODUCTION_ORDERS_ID) no está configurado en Netlify.");
        }

        // Usamos la función fetch directamente.
        const response = await fetch(GOOGLE_SHEET_URL);
        if (!response.ok) {
            throw new Error(`Error al descargar el CSV de Google: ${response.status}. Verifica que la hoja sea accesible para 'Cualquier persona con el enlace'.`);
        }

        const csvText = await response.text();
        
        // 3. Procesamos el texto CSV.
        // Limpia comillas dobles, divide por filas, y salta la primera fila (encabezado).
        const rows = csvText.replace(/"/g, '').split('\n').slice(1);
        
        const processedData = rows.map(row => {
            const columns = row.split(',');

            if (columns.length < 22) return null;

            const resource = columns[0];
            const status = columns[21];

            // Filtra operadores y órdenes que no están liberadas.
            if (!resource || resource.startsWith('O') || status !== 'Released') {
                return null;
            }

            // Crea el objeto con los datos de la fila.
            return {
                resource,
                department: columns[3],
                requiredQty: parseFloat(columns[8]) || 0,
                openQty: parseFloat(columns[10]) || 0,
                startDate: new Date(columns[13]).toISOString(),
                job: columns[18],
                assembly: columns[20],
                status,
                resourceDescription: columns[23] || ''
            };
        }).filter(Boolean); // Limpia cualquier fila inválida.

        // Retorna los datos procesados.
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(processedData)
        };

    } catch (error) {
        console.error("Error en la función:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Hubo un fallo en el robot.', details: error.message })
        };
    }
};