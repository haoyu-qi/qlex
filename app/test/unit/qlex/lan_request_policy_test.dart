import 'package:common/model/dto/file_dto.dart';
import 'package:common/model/file_type.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:localsend_app/qlex/lan_request_policy.dart';

void main() {
  FileDto file({required FileType type, String? preview}) =>
      FileDto(id: 'id', fileName: 'note.txt', size: 4, fileType: type, hash: null, preview: preview, metadata: null, legacy: false);

  test('rejects a dedicated inline text message', () {
    expect(isTextMessageRequest([file(type: FileType.text, preview: 'hello')]), isTrue);
  });

  test('allows a normal text file without inline preview', () {
    expect(isTextMessageRequest([file(type: FileType.text)]), isFalse);
  });

  test('allows ordinary files', () {
    expect(isTextMessageRequest([file(type: FileType.other)]), isFalse);
  });

  test('rejects an inline text item mixed into a file request', () {
    expect(isTextMessageRequest([file(type: FileType.other), file(type: FileType.text, preview: 'hello')]), isTrue);
  });

  test('provides localized rejection copy', () {
    expect(textMessageRejectedMessage(simplifiedChinese: true), contains('不支持文本消息'));
    expect(textMessageRejectedMessage(simplifiedChinese: false), contains('Text messages'));
  });
}
