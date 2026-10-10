from django.db import models


class Song(models.Model):
    title = models.CharField(max_length=200, blank=True)
    language = models.CharField(max_length=20, default='en-US')  # BCP-47 tag
    genre = models.CharField(max_length=60, default='pop')
    mood = models.CharField(max_length=60, default='uplifting')
    vocal = models.CharField(max_length=20, default='female')
    tempo = models.PositiveIntegerField(default=96)
    key = models.CharField(max_length=10, default='C')
    lyrics = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
