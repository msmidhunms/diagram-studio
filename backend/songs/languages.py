"""Languages offered in the song studio, as BCP-47 tags (what browsers' speech voices use)."""

LANGUAGES = {
    'en-US': 'English (US)', 'en-GB': 'English (UK)', 'en-IN': 'English (India)',
    'hi-IN': 'Hindi', 'ml-IN': 'Malayalam', 'ta-IN': 'Tamil', 'te-IN': 'Telugu',
    'kn-IN': 'Kannada', 'bn-IN': 'Bengali', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati',
    'pa-IN': 'Punjabi', 'ur-PK': 'Urdu', 'es-ES': 'Spanish', 'es-MX': 'Spanish (Mexico)',
    'pt-BR': 'Portuguese (Brazil)', 'fr-FR': 'French', 'de-DE': 'German', 'it-IT': 'Italian',
    'nl-NL': 'Dutch', 'ru-RU': 'Russian', 'tr-TR': 'Turkish', 'ar-SA': 'Arabic',
    'ja-JP': 'Japanese', 'ko-KR': 'Korean', 'zh-CN': 'Chinese (Mandarin)', 'id-ID': 'Indonesian',
    'fil-PH': 'Filipino', 'sw-KE': 'Swahili',
}


def name(code: str) -> str:
    return LANGUAGES.get(code, code)
