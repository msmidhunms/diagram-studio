from django.urls import path

from . import views

urlpatterns = [
    path('diagrams/', views.diagram_list),
    path('diagrams/generate/', views.generate),
    path('diagrams/<int:pk>/', views.diagram_detail),
    path('diagrams/<int:pk>/repair/', views.repair),
]
