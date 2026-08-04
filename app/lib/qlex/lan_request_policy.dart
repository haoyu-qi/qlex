import 'package:common/model/dto/file_dto.dart';
import 'package:common/model/file_type.dart';

/// LocalSend represents a text message as a text item with an inline preview.
/// A normal `.txt` file has no preview and remains a valid qlex file transfer.
bool isTextMessageRequest(Iterable<FileDto> files) {
  return files.any((file) => file.fileType == FileType.text && file.preview != null);
}

String textMessageRejectedMessage({required bool simplifiedChinese}) {
  return simplifiedChinese ? 'qlex 仅传输文件，不支持文本消息。' : 'qlex transfers files only. Text messages are not supported.';
}
