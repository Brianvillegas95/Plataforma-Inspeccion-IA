const { google } = require('googleapis');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { imagenBase64 } = JSON.parse(event.body);
    if (!imagenBase64) {
      return { statusCode: 400, body: 'No se proporcionó ninguna imagen.' };
    }

    const imageContent = imagenBase64.split(',')[1];
    if (!imageContent) {
      return { statusCode: 400, body: 'El formato de la imagen Base64 es incorrecto.' };
    }

    // 1. Autenticación (igual que antes)
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/cloud-vision'], 
    });

    // 2. Obtenemos un "token" de acceso temporal
    const authToken = await auth.getAccessToken();

    // 3. Preparamos el cuerpo de la petición para la API de Vision
    const requestBody = {
      requests: [
        {
          image: {
            content: imageContent,
          },
          features: [
            { type: 'TEXT_DETECTION' },
          ],
        },
      ],
    };

    // 4. Hacemos la llamada manualmente con FETCH
    const visionApiUrl = 'https://vision.googleapis.com/v1/images:annotate';
    
    const apiResponse = await fetch(visionApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!apiResponse.ok) {
        const errorBody = await apiResponse.text();
        throw new Error(`La API de Google respondió con un error: ${apiResponse.status} ${errorBody}`);
    }

    const result = await apiResponse.json();

    // 5. Procesamos la respuesta (igual que antes)
    const detectedText = result.responses[0]?.fullTextAnnotation?.text || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textoDetectado: detectedText }),
    };

  } catch (error) {
    console.error('Error detallado:', error.message);
    return {
      statusCode: 500,
      body: `Error interno al analizar la imagen: ${error.message}`,
    };
  }
};