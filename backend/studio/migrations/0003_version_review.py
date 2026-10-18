from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('studio', '0002_version_model'),
    ]

    operations = [
        migrations.AddField(
            model_name='diagramversion',
            name='review',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
