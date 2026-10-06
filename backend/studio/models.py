from django.db import models


class Diagram(models.Model):
    FORMATS = [('mermaid', 'Mermaid'), ('svg', 'SVG')]

    title = models.CharField(max_length=200, blank=True)
    format = models.CharField(max_length=10, choices=FORMATS)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def latest(self):
        return self.versions.order_by('-number').first()


class DiagramVersion(models.Model):
    diagram = models.ForeignKey(Diagram, related_name='versions', on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    prompt = models.TextField()
    code = models.TextField()
    explanation = models.TextField(blank=True)
    repairs = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['number']
        unique_together = [('diagram', 'number')]
