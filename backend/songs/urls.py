from django.urls import path

from . import views

urlpatterns = [
    path('songs/', views.song_list),
    path('songs/capabilities/', views.capabilities),
    path('songs/lyrics/', views.write_lyrics),
    path('songs/speak/', views.speak),
    path('songs/<int:pk>/', views.song_detail),
    path('songs/<int:pk>/compose/', views.compose),
]
