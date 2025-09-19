// Archivo: netlify/functions/chatbot.js (versión para dos hojas)

const { google } = require('googleapis');

const { GOOGLE_SHEET_ID_CHATBOT, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

// --- Helper para convertir arrays de Google Sheets en objetos legibles ---
function sheetsArrayToObject(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = row[index];
    });
    return rowObject;
  });
}

exports.handler = async function(event) {
  // El ID de la categoría que el usuario seleccionó. 
  // Usamos '0' como el ID especial para el nivel más alto (categorías sin padre).
  const currentId = event.queryStringParameters.id || '0';

  try {
    const auth = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({ version: 'v4', auth });

    // Leemos AMBAS hojas en una sola llamada a la API para ser más eficientes
    const responseData = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: GOOGLE_SHEET_ID_CHATBOT,
      ranges: ['Categorias', 'Informacion'],
    });

    const [categoriasRows, informacionRows] = responseData.data.valueRanges;

    // Convertimos los datos crudos en objetos más fáciles de usar
    const categorias = sheetsArrayToObject(categoriasRows.values);
    const informacion = sheetsArrayToObject(informacionRows.values);

    // 1. PRIMERO, BUSCAMOS SI HAY INFORMACIÓN FINAL PARA ESTE ID
    const infoFinal = informacion.find(item => item.id_categoria === currentId);

    if (infoFinal) {
  // Si encontramos información, la enviamos de forma estructurada con título y contenido.
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: infoFinal.titulo,    // Enviamos el título
      content: infoFinal.contenido, // Enviamos el contenido
      options: [{ text: 'Volver al inicio', nextId: '0' }] // Opción para reiniciar
    })
  };
}

    // 2. SI NO HAY INFO, BUSCAMOS SUBCATEGORÍAS
    // Buscamos la pregunta de la categoría actual
    const categoriaActual = categorias.find(cat => cat.id_categoria === currentId)
    const pregunta = categoriaActual ? categoriaActual.pregunta : 'Selecciona una de las siguientes opciones:';

    // Buscamos todas las categorías hijas de la actual
    const subCategorias = categorias.filter(cat => {
        // El id_padre '0' o vacío significa que es una categoría principal
        return (currentId === '0') ? !cat.id_padre || cat.id_padre === '0' : cat.id_padre === currentId;
    });

    // Formateamos las subcategorías como opciones para el chatbot
    const options = subCategorias.map(subCat => ({
      text: subCat.nombre,
      nextId: subCat.id_categoria
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: pregunta, options: options })
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno del servidor.' }) };
  }
};