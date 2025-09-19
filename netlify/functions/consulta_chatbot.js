// Archivo: netlify/functions/consulta_chatbot.js

const { google } = require('googleapis');
const { GOOGLE_SHEET_ID_CHATBOT, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

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
  const currentId = event.queryStringParameters.id || '0';

  try {
    const auth = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({ version: 'v4', auth });

    const responseData = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: GOOGLE_SHEET_ID_CHATBOT,
      ranges: ['Categorias', 'Informacion'],
    });

    const [categoriasRows, informacionRows] = responseData.data.valueRanges;
    const categorias = sheetsArrayToObject(categoriasRows.values);
    const informacion = sheetsArrayToObject(informacionRows.values);

    const infoFinal = informacion.find(item => item.id_categoria === currentId);

    if (infoFinal) {
      // Si encontramos información, la enviamos de forma estructurada con título y contenido.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: infoFinal.titulo,
          content: infoFinal.contenido,
          options: [{ text: 'Volver al inicio', nextId: '0' }]
        })
      };
    }

    const categoriaActual = categorias.find(cat => cat.id_categoria === currentId);
    const pregunta = categoriaActual ? categoriaActual.pregunta : 'Selecciona una de las siguientes opciones:';

    const subCategorias = categorias.filter(cat => {
        return (currentId === '0') ? !cat.id_padre || cat.id_padre === '0' : cat.id_padre === currentId;
    });

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