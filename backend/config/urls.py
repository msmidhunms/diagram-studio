from django.urls import include, path

urlpatterns = [path('api/', include('studio.urls')), path('api/', include('songs.urls'))]
