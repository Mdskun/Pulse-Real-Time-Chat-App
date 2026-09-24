from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Message, Room
from .serializers import MessageSerializer, RoomSerializer

User = get_user_model()


class RoomListCreateView(generics.ListCreateAPIView):
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Room.objects.filter(participants=self.request.user)

    def create(self, request, *args, **kwargs):
        participant_ids = request.data.get("participant_ids", [])
        is_group = bool(request.data.get("is_group", False))
        name = request.data.get("name", "")

        if not isinstance(participant_ids, list):
            return Response(
                {"participant_ids": ["Must be a list of user IDs."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        other_ids = []
        seen = set()
        for raw_id in participant_ids:
            if isinstance(raw_id, bool):
                return Response(
                    {"participant_ids": [f"Invalid user ID: {raw_id}"]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                user_id = int(raw_id)
            except (TypeError, ValueError):
                return Response(
                    {"participant_ids": [f"Invalid user ID: {raw_id}"]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if user_id == request.user.id:
                continue
            if user_id in seen:
                continue
            seen.add(user_id)
            other_ids.append(user_id)

        if not other_ids:
            return Response(
                {"participant_ids": ["At least one other participant is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_count = User.objects.filter(id__in=other_ids).count()
        if valid_count != len(other_ids):
            return Response(
                {"participant_ids": ["One or more participants do not exist."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_group and len(other_ids) != 1:
            return Response(
                {"participant_ids": ["Direct messages must have exactly one other participant."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            if not is_group:
                existing = (
                    Room.objects.select_for_update()
                    .filter(is_group=False, participants=request.user)
                    .filter(participants__id=other_ids[0])
                    .first()
                )
                if existing:
                    return Response(
                        RoomSerializer(existing, context={"request": request}).data,
                        status=status.HTTP_200_OK,
                    )

            room = Room.objects.create(name=name, is_group=is_group)
            room.participants.add(request.user, *other_ids)
            return Response(
                RoomSerializer(room, context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )


class RoomDetailView(generics.RetrieveAPIView):
    serializer_class = RoomSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Room.objects.all()

    def get_queryset(self):
        return Room.objects.filter(participants=self.request.user)


class MessageListView(generics.ListAPIView):
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        room = get_object_or_404(
            Room, id=self.kwargs["room_id"], participants=self.request.user
        )
        return room.messages.select_related("sender").all()


class MarkReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, room_id):
        room = get_object_or_404(Room, id=room_id, participants=request.user)
        room.messages.exclude(sender=request.user).update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)
